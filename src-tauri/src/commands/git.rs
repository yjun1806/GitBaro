// ── Git operation strategy ──────────────────────────────────────────────────
// 읽기 전용 (status, diff): git2 (libgit2) — 성능 우선
// 쓰기 + hooks (commit, stash): GitCliEngine — hooks 실행 보장
// 리모트 (fetch, push, pull): GitCliEngine + AskpassScript — 인증

use crate::commands::auth::resolve_token;
use crate::error::AppError;
use crate::events::{
    GitCommandCompleteEvent, GitCommandStartEvent, GIT_COMMAND_COMPLETE, GIT_COMMAND_START,
};
use crate::git::cli::GitCliEngine;
use crate::git::engine::{GitEngine, GitRemoteEngine};
use crate::state::TokenStore;
use serde_json::{json, Value};
use tauri::Emitter;

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
                if let Ok(Some(patch)) = git2::Patch::from_diff(&staged_diff, idx) {
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

            // Unstaged diff: index-to-workdir
            let mut unstaged_opts = git2::DiffOptions::new();
            unstaged_opts.include_untracked(true);
            let unstaged_diff = repo.diff_index_to_workdir(None, Some(&mut unstaged_opts))?;

            for idx in 0..unstaged_diff.deltas().count() {
                if let Ok(Some(patch)) = git2::Patch::from_diff(&unstaged_diff, idx) {
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

        let entries: Vec<Value> = statuses
            .iter()
            .filter_map(|entry| {
                let path = entry.path()?.to_string();
                let status = entry.status();

                let conflicted = status.contains(git2::Status::CONFLICTED);

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
                    "conflicted": conflicted,
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
pub async fn stage_files(
    app_handle: tauri::AppHandle,
    repo_path: String,
    paths: Vec<String>,
) -> Result<(), AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let started_at = chrono::Utc::now().timestamp_millis();
    let path_list = paths.join(", ");
    let _ = app_handle.emit(
        GIT_COMMAND_START,
        GitCommandStartEvent {
            id: id.clone(),
            command: format!("git add {}", path_list),
            operation: "stage".to_string(),
            repo_path: repo_path.clone(),
            started_at,
            automatic: false,
        },
    );

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

    let duration_ms = (chrono::Utc::now().timestamp_millis() - started_at) as u64;
    let _ = app_handle.emit(
        GIT_COMMAND_COMPLETE,
        GitCommandCompleteEvent {
            id,
            operation: "stage".to_string(),
            success: true,
            duration_ms,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: Some(0),
            result_summary: None,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn unstage_files(
    app_handle: tauri::AppHandle,
    repo_path: String,
    paths: Vec<String>,
) -> Result<(), AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let started_at = chrono::Utc::now().timestamp_millis();
    let path_list = paths.join(", ");
    let _ = app_handle.emit(
        GIT_COMMAND_START,
        GitCommandStartEvent {
            id: id.clone(),
            command: format!("git reset HEAD {}", path_list),
            operation: "unstage".to_string(),
            repo_path: repo_path.clone(),
            started_at,
            automatic: false,
        },
    );

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

    let duration_ms = (chrono::Utc::now().timestamp_millis() - started_at) as u64;
    let _ = app_handle.emit(
        GIT_COMMAND_COMPLETE,
        GitCommandCompleteEvent {
            id,
            operation: "unstage".to_string(),
            success: true,
            duration_ms,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: Some(0),
            result_summary: None,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn create_commit(
    app_handle: tauri::AppHandle,
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

    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
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
    // Discarding is a write op → go through git CLI (hybrid strategy) instead of
    // git2 checkout_index, keeping hook behaviour consistent with other writes.
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    engine.discard_paths(&paths).await?;
    Ok(())
}

/// Check if a git CLI error is an authentication failure.
pub(crate) fn is_auth_error(err: &AppError) -> bool {
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
    automatic: Option<bool>,
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    let token = resolve_token(&token_store, &account_id).await?;
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle)
        .with_automatic(automatic.unwrap_or(false));

    match engine.fetch("origin", &token).await {
        Ok(()) => {
            tracing::info!("Fetched origin for {}", repo_path);
        }
        Err(e) if is_auth_error(&e) => {
            tracing::warn!("Fetch auth failed, refreshing token for {}", account_id);
            let new_token = token_store.refresh_token(&account_id).await?;
            engine.fetch("origin", &new_token).await?;
            tracing::info!("Fetched origin for {} (after token refresh)", repo_path);
        }
        Err(e) => return Err(e),
    }

    // GitHub Desktop parity: advance eligible non-current local branches so a
    // fetch from any branch keeps the others (e.g. main) up to date.
    fast_forward_local_branches(&engine, &repo_path).await;
    Ok(())
}

/// Compute local branches that can be fast-forwarded to their upstream after a
/// fetch: has an upstream, is not the current HEAD, and is strictly behind
/// (ahead == 0, behind > 0). Returns `(branch_name, from_oid, to_oid)`.
async fn fast_forward_candidates(
    repo_path: &str,
) -> Result<Vec<(String, String, String)>, AppError> {
    let rp = repo_path.to_string();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&rp)?;
        let head_name = repo
            .head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()));

        let mut candidates = Vec::new();
        for branch_result in repo.branches(Some(git2::BranchType::Local))? {
            let (branch, _) = branch_result?;
            let name = match branch.name()? {
                Some(n) => n.to_string(),
                None => continue,
            };
            if head_name.as_deref() == Some(name.as_str()) {
                continue; // never move the checked-out branch
            }
            let upstream = match branch.upstream() {
                Ok(u) => u,
                Err(_) => continue, // no upstream configured
            };
            let (local_oid, up_oid) = match (branch.get().target(), upstream.get().target()) {
                (Some(l), Some(u)) => (l, u),
                _ => continue,
            };
            if local_oid == up_oid {
                continue; // already up to date
            }
            // Pure fast-forward only: local must be a strict ancestor of upstream.
            let (ahead, behind) = repo.graph_ahead_behind(local_oid, up_oid).unwrap_or((0, 0));
            if ahead == 0 && behind > 0 {
                candidates.push((name, local_oid.to_string(), up_oid.to_string()));
            }
        }
        Ok::<_, AppError>(candidates)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// After fetching, fast-forward every eligible non-current local branch to its
/// upstream. Failures are non-fatal — a successful fetch must not fail because
/// one branch could not be advanced (e.g. it is checked out in a worktree).
async fn fast_forward_local_branches(engine: &GitCliEngine, repo_path: &str) {
    let candidates = match fast_forward_candidates(repo_path).await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("[git] fast-forward scan failed: {}", e);
            return;
        }
    };
    for (name, from, to) in candidates {
        match engine.fast_forward_branch(&name, &to).await {
            Ok(()) => tracing::info!(
                "[git] fast-forwarded {} {}..{}",
                name,
                &from[..from.len().min(7)],
                &to[..to.len().min(7)]
            ),
            Err(e) => tracing::warn!("[git] skipped fast-forward for {}: {}", name, e),
        }
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
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    let token = resolve_token(&token_store, &account_id).await?;
    let branch = resolve_head_branch(&repo_path).await?;

    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
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

/// Tag names present on `origin`, used to mark local-only tags in the history
/// timeline. Read-only network call; retries once on auth failure.
#[tauri::command]
pub async fn list_remote_tags(
    repo_path: String,
    account_id: String,
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<Vec<String>, AppError> {
    let token = resolve_token(&token_store, &account_id).await?;
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);

    match engine.list_remote_tags("origin", &token).await {
        Ok(tags) => Ok(tags),
        Err(e) if is_auth_error(&e) => {
            tracing::warn!("ls-remote auth failed, refreshing token for {}", account_id);
            let new_token = token_store.refresh_token(&account_id).await?;
            engine.list_remote_tags("origin", &new_token).await
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn git_pull(
    repo_path: String,
    account_id: String,
    rebase: Option<bool>,
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    let token = resolve_token(&token_store, &account_id).await?;
    let branch = resolve_upstream_branch(&repo_path).await?;

    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
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
pub async fn stash_push(
    app_handle: tauri::AppHandle,
    repo_path: String,
    message: Option<String>,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.stash_save(message.as_deref()).await?;
    tracing::info!("Stash saved");
    Ok(())
}

#[tauri::command]
pub async fn stash_pop(
    app_handle: tauri::AppHandle,
    repo_path: String,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.stash_pop().await?;
    tracing::info!("Stash popped");
    Ok(())
}

#[tauri::command]
pub async fn stash_list(
    repo_path: String,
) -> Result<Vec<crate::git::engine::StashEntry>, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let engine =
            crate::git::libgit::LibGitEngine::open(std::path::Path::new(&repo_path))?;
        engine.stash_list()
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;
    Ok(result)
}

#[tauri::command]
pub async fn stash_apply(
    app_handle: tauri::AppHandle,
    repo_path: String,
    index: usize,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.stash_apply(index).await?;
    tracing::info!("Stash applied: stash@{{{}}}", index);
    Ok(())
}

#[tauri::command]
pub async fn stash_drop(
    app_handle: tauri::AppHandle,
    repo_path: String,
    index: usize,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.stash_drop(index).await?;
    tracing::info!("Stash dropped: stash@{{{}}}", index);
    Ok(())
}

#[tauri::command]
pub async fn stash_show(
    repo_path: String,
    index: usize,
) -> Result<crate::git::engine::StashShowResult, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let engine =
            crate::git::libgit::LibGitEngine::open(std::path::Path::new(&repo_path))?;
        engine.stash_show(index)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;
    Ok(result)
}

#[tauri::command]
pub async fn stash_push_partial(
    app_handle: tauri::AppHandle,
    repo_path: String,
    paths: Vec<String>,
    message: Option<String>,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.stash_push_paths(message.as_deref(), &paths).await?;
    tracing::info!("Stash pushed (partial): {} files", paths.len());
    Ok(())
}

/// Append `pattern` to the repo's `.gitignore` (creating it if absent).
/// Skips when an identical trimmed line already exists. Pure file write — no
/// git invocation needed.
#[tauri::command]
pub async fn add_to_gitignore(repo_path: String, pattern: String) -> Result<(), AppError> {
    let log_pattern = pattern.clone();
    tokio::task::spawn_blocking(move || {
        let entry = pattern.trim();
        if entry.is_empty() {
            return Err(AppError::GitCli {
                message: "gitignore pattern cannot be empty".to_string(),
                exit_code: None,
            });
        }
        // 정확히 이 파일만 무시하도록 루트 기준으로 앵커링한다. 선행 슬래시가
        // 없으면 같은 이름의 모든 경로가 무시되므로 '/'를 붙인다.
        let anchored = if entry.starts_with('/') {
            entry.to_string()
        } else {
            format!("/{entry}")
        };
        let path = std::path::Path::new(&repo_path).join(".gitignore");
        // NotFound는 "새로 생성"으로, 그 외 읽기 오류는 전파한다. unwrap_or_default로
        // 삼키면 읽기 실패 시 기존 .gitignore를 통째로 덮어써 내용이 유실될 수 있다.
        let existing = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(e.into()),
        };
        if existing.lines().any(|line| line.trim() == anchored) {
            return Ok(()); // 이미 무시 목록에 있음
        }
        let mut content = existing;
        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&anchored);
        content.push('\n');
        std::fs::write(&path, content)?;
        Ok::<_, AppError>(())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;
    tracing::info!("Added to .gitignore: {}", log_pattern);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(dir: &std::path::Path, args: &[&str]) {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .expect("git 실행 실패");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
    }

    /// 링크된 워크트리에서도 작업 트리 변경이 보고되어야 한다.
    /// 워크트리의 `.git` 은 디렉토리가 아니라 파일이라, 저장소를 여는 쪽이
    /// 이를 따라가지 못하면 변경이 하나도 안 잡힌다.
    #[tokio::test]
    async fn reports_changes_made_inside_a_linked_worktree() {
        let tmp = std::env::temp_dir().join(format!("gitbaro-wt-status-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let main = tmp.join("main");
        std::fs::create_dir_all(&main).unwrap();

        git(&main, &["init", "-q", "-b", "main"]);
        git(&main, &["config", "user.email", "t@t"]);
        git(&main, &["config", "user.name", "t"]);
        std::fs::write(main.join("README.md"), "hello\n").unwrap();
        git(&main, &["add", "-A"]);
        git(&main, &["commit", "-qm", "init"]);

        let wt = tmp.join("feature");
        git(&main, &["worktree", "add", "-q", "-b", "feature", wt.to_str().unwrap()]);

        // 워크트리 안에서 추적 파일 수정 + 새 파일 추가
        std::fs::write(wt.join("README.md"), "hello\nchanged in worktree\n").unwrap();
        std::fs::write(wt.join("new-file.txt"), "brand new\n").unwrap();

        let entries = get_status(wt.to_string_lossy().to_string())
            .await
            .expect("워크트리 status 조회 실패");

        let paths: Vec<String> = entries
            .iter()
            .filter_map(|e| e.get("path").and_then(|p| p.as_str()).map(String::from))
            .collect();

        let _ = std::fs::remove_dir_all(&tmp);

        assert!(paths.contains(&"README.md".to_string()), "수정 파일 누락: {:?}", paths);
        assert!(paths.contains(&"new-file.txt".to_string()), "새 파일 누락: {:?}", paths);
    }
}
