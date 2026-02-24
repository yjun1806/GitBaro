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

                Some(json!({
                    "path": path,
                    "staged": staged,
                    "unstaged": unstaged,
                    "indexStatus": index_status,
                    "worktreeStatus": wt_status,
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
                index.add_path(std::path::Path::new(path))?;
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
            let email = if email.is_empty() {
                format!("{}@users.noreply.github.com", name)
            } else {
                email
            };
            (name, email)
        })
    } else {
        None
    };

    let oid = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let mut index = repo.index()?;
        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;

        let sig = if let Some((ref name, ref email)) = account_info {
            git2::Signature::now(name, email)?
        } else {
            repo.signature()?
        };

        let oid = if amend {
            let head = repo.head()?;
            let parent_commit = head.peel_to_commit()?;
            let new_oid = parent_commit.amend(
                Some("HEAD"),
                Some(&sig),
                Some(&sig),
                None,
                Some(&message),
                Some(&tree),
            )?;
            new_oid
        } else {
            let parent_commits: Vec<git2::Commit> = match repo.head() {
                Ok(head) => vec![head.peel_to_commit()?],
                Err(_) => vec![],
            };
            let parents: Vec<&git2::Commit> = parent_commits.iter().collect();
            repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)?
        };

        Ok::<_, AppError>(oid.to_string())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

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

#[tauri::command]
pub async fn git_push(
    repo_path: String,
    account_id: String,
    force: Option<bool>,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    let token = resolve_token(&token_store, &account_id).await?;
    let branch = tokio::task::spawn_blocking({
        let rp = repo_path.clone();
        move || -> Result<String, AppError> {
            let repo = git2::Repository::open(&rp)?;
            let head = repo.head()?;
            let name = head
                .shorthand()
                .ok_or_else(|| AppError::GitCli {
                    message: "HEAD is detached".to_string(),
                    exit_code: None,
                })?
                .to_string();
            Ok(name)
        }
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

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
    let branch = tokio::task::spawn_blocking({
        let rp = repo_path.clone();
        move || -> Result<String, AppError> {
            let repo = git2::Repository::open(&rp)?;
            let head = repo.head()?;
            let name = head
                .shorthand()
                .ok_or_else(|| AppError::GitCli {
                    message: "HEAD is detached".to_string(),
                    exit_code: None,
                })?
                .to_string();
            Ok(name)
        }
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

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
