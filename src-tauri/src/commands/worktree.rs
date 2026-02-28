use crate::error::AppError;
use crate::git::branch::validate_branch_name;
use crate::git::cli::{GitCliEngine, WorktreeEntry};

#[tauri::command]
pub async fn get_worktrees(repo_path: String) -> Result<Vec<WorktreeEntry>, AppError> {
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    let mut entries = engine.list_worktrees().await?;

    // Check dirty status for each worktree
    for entry in &mut entries {
        if entry.is_bare {
            continue;
        }
        let dirty = tokio::task::spawn_blocking({
            let path = entry.path.clone();
            move || -> bool {
                let Ok(repo) = git2::Repository::open(&path) else {
                    return false;
                };
                let mut opts = git2::StatusOptions::new();
                opts.include_untracked(true);
                let Ok(statuses) = repo.statuses(Some(&mut opts)) else {
                    return false;
                };
                !statuses.is_empty()
            }
        })
        .await
        .unwrap_or(false);
        entry.is_dirty = dirty;
    }

    Ok(entries)
}

#[tauri::command]
pub async fn add_worktree(
    repo_path: String,
    path: String,
    branch: Option<String>,
    new_branch: Option<String>,
    base_branch: Option<String>,
) -> Result<(), AppError> {
    if let Some(ref name) = new_branch {
        validate_branch_name(name)?;
    }
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    engine
        .add_worktree(&path, branch.as_deref(), new_branch.as_deref(), base_branch.as_deref())
        .await?;
    tracing::info!("Added worktree: {}", path);
    Ok(())
}

#[tauri::command]
pub async fn remove_worktree(
    repo_path: String,
    path: String,
    force: bool,
) -> Result<(), AppError> {
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    engine.remove_worktree(&path, force).await?;
    tracing::info!("Removed worktree: {}", path);
    Ok(())
}

#[tauri::command]
pub async fn start_worktree_preview(
    repo_path: String,
    branch: String,
) -> Result<(), AppError> {
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    engine.start_preview(&branch).await?;
    tracing::info!("Started preview of branch: {}", branch);
    Ok(())
}

#[tauri::command]
pub async fn stop_worktree_preview(repo_path: String) -> Result<(), AppError> {
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    engine.stop_preview().await?;
    tracing::info!("Stopped preview");
    Ok(())
}

#[tauri::command]
pub async fn check_preview_active(repo_path: String) -> Result<bool, AppError> {
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    engine.is_merging().await
}
