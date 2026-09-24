//! 워크트리별 「새 커밋」 계산용 커맨드. 기준선은 프론트엔드(`gitbaro-review-seen`)가 저장한다.

use crate::error::AppError;
use crate::git::new_commits::{
    count_new_commits as count_one, list_new_commit_ids as list_ids, list_review_worktrees,
    NewCommitCount, NewCommitIds, RepoReviewStatus, SeenRecord,
};

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

/// 워크트리마다 기준선 뒤의 새 커밋 수. HEAD 가 없거나 열 수 없는 워크트리는 결과에서 빠진다.
#[tauri::command]
pub async fn count_new_commits(entries: Vec<SeenRecord>) -> Result<Vec<NewCommitCount>, AppError> {
    tokio::task::spawn_blocking(move || {
        entries
            .iter()
            .filter_map(|entry| match count_one(entry) {
                Ok(count) => Some(count),
                Err(e) => {
                    tracing::warn!("[review] count_new_commits skipped {}: {}", entry.path, e);
                    None
                }
            })
            .collect()
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))
}

// W3-T3
/// 한 워크트리의 새 커밋 수와 새 커밋으로 센 커밋의 SHA. 커밋 그래프가 새 커밋 점과
/// 「여기까지 확인함」 구분선을 `count_new_commits` 와 같은 커밋에 그리는 데 쓴다.
#[tauri::command]
pub async fn list_new_commit_ids(entry: SeenRecord) -> Result<NewCommitIds, AppError> {
    tokio::task::spawn_blocking(move || list_ids(&entry).map_err(AppError::from))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))?
}
