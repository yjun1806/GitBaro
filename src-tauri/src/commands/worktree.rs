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
