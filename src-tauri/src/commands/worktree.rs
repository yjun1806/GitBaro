use crate::error::AppError;
use crate::git::branch::validate_branch_name;
use crate::git::cli::{GitCliEngine, WorktreeEntry};
use crate::git::worktree_base::resolve_worktree_base_cached;

#[tauri::command]
pub async fn get_worktrees(
    repo_path: String,
) -> Result<Vec<WorktreeEntry>, AppError> {
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

    // 링크된 워크트리마다 기반 브랜치를 판별한다. 참조가 그대로면 캐시된 값을 쓴다.
    let targets: Vec<(usize, String)> = entries
        .iter()
        .enumerate()
        .filter(|(_, e)| !e.is_main && !e.is_bare)
        .filter_map(|(i, e)| e.branch.clone().map(|b| (i, b)))
        .collect();
    if !targets.is_empty() {
        let bases = tokio::task::spawn_blocking(move || {
            let Ok(repo) = git2::Repository::open(&repo_path) else {
                return Vec::new();
            };
            targets
                .into_iter()
                .map(|(i, branch)| (i, resolve_worktree_base_cached(&repo, &branch)))
                .collect::<Vec<_>>()
        })
        .await
        .unwrap_or_default();
        for (i, base) in bases {
            if let Some(entry) = entries.get_mut(i) {
                entry.base = base;
            }
        }
    }

    Ok(entries)
}

#[tauri::command]
pub async fn add_worktree(
    app_handle: tauri::AppHandle,
    repo_path: String,
    path: String,
    branch: Option<String>,
    new_branch: Option<String>,
    base_branch: Option<String>,
) -> Result<(), AppError> {
    if let Some(ref name) = new_branch {
        validate_branch_name(name)?;
    }
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine
        .add_worktree(&path, branch.as_deref(), new_branch.as_deref(), base_branch.as_deref())
        .await?;
    tracing::info!("Added worktree: {}", path);
    Ok(())
}

#[tauri::command]
pub async fn remove_worktree(
    app_handle: tauri::AppHandle,
    repo_path: String,
    path: String,
    force: bool,
) -> Result<(), AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    engine.remove_worktree(&path, force).await?;
    tracing::info!("Removed worktree: {}", path);
    Ok(())
}
