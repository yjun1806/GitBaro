use crate::error::AppError;
use crate::git::cli::{GitCliEngine, WorktreeEntry};

#[tauri::command]
pub async fn get_worktrees(repo_path: String) -> Result<Vec<WorktreeEntry>, AppError> {
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    engine.list_worktrees().await
}

#[tauri::command]
pub async fn add_worktree(
    repo_path: String,
    path: String,
    branch: Option<String>,
    new_branch: Option<String>,
) -> Result<(), AppError> {
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    engine
        .add_worktree(&path, branch.as_deref(), new_branch.as_deref())
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
