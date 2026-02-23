use crate::error::AppError;
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

        for path in &paths {
            index.add_path(std::path::Path::new(path))?;
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
) -> Result<String, AppError> {
    let oid = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let mut index = repo.index()?;
        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;

        let sig = repo.signature()?;

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

