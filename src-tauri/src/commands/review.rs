//! 등록된 저장소들의 워크트리 목록 커맨드.

use crate::error::AppError;
use crate::git::review_worktrees::{list_review_worktrees, RepoReviewStatus};

/// 저장소마다 워크트리 목록(메인 작업 트리 포함)과 각 워크트리의 브랜치·HEAD 를 한 번에 돌려준다.
/// 열 수 없는 저장소(경로가 사라짐 등)는 결과에서 빠진다. 한 곳의 실패로 전체를 버리지 않는다.
#[tauri::command]
pub async fn review_status(repo_paths: Vec<String>) -> Result<Vec<RepoReviewStatus>, AppError> {
    tokio::task::spawn_blocking(move || {
        repo_paths
            .iter()
            .filter_map(|path| match list_review_worktrees(path) {
                Ok(status) => Some(status),
                Err(e) => {
                    tracing::warn!("[review] review_status skipped {}: {}", path, e);
                    None
                }
            })
            .collect()
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))
}
