//! 원격에 올리지 않은 커밋 목록. push 확인 창이 무엇이 올라가는지 보여 주는 데 쓴다.
//! `get_unpushed_file_touches`는 같은 커밋을 파일별로 묶는다(워크스페이스 리뷰의 「파일별 보기」).

use crate::error::AppError;
use crate::git::commit::commit_to_info;
use crate::git::file_touches::{repo_file_touches_cached, RepoFileTouches, FILE_TOUCHES_LIMIT};
use crate::git::unpushed::{head_unpushed, UNPUSHED_LIMIT};
use crate::git::CommitInfo;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnpushedCommits {
    /// 원격에 없는 커밋 수(많아야 `UNPUSHED_LIMIT`).
    pub count: usize,
    pub has_upstream: bool,
    pub has_remote: bool,
    /// 앞에서부터 많아야 `limit`개(최신 순).
    pub commits: Vec<CommitInfo>,
}

/// HEAD에서 닿지만 어느 원격 추적 브랜치에도 없는 커밋(`git rev-list HEAD --not --remotes`).
#[tauri::command]
pub async fn get_unpushed_commits(repo_path: String, limit: Option<usize>) -> Result<UnpushedCommits, AppError> {
    let limit = limit.unwrap_or(50);
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let summary = head_unpushed(&repo, UNPUSHED_LIMIT)?;
        let commits = summary
            .oids
            .iter()
            .take(limit)
            .filter_map(|oid| repo.find_commit(*oid).ok())
            .map(|c| commit_to_info(&c))
            .collect();
        Ok::<_, AppError>(UnpushedCommits {
            count: summary.oids.len(),
            has_upstream: summary.has_upstream,
            has_remote: summary.has_remote,
            commits,
        })
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// 저장소(워크트리)마다 push 하면 바뀌는 파일과, 파일마다 그 파일을 건드린 원격에 없는 커밋(병합 커밋 제외).
/// 결과는 `paths` 순서다. 저장소마다 따로 읽는다: 한 곳이 실패하면 그 결과의 `error`만 채운다.
/// HEAD·추적 브랜치·원격 참조가 그대로인 저장소는 지난 결과를 준다(`repo_file_touches_cached`). 파일 diff 는
/// `get_range_file_diff`로 본다(합친 변경은 `rangeBase` → `head`, 커밋 하나는 `parentOid` → `oid`).
#[tauri::command]
pub async fn get_unpushed_file_touches(paths: Vec<String>) -> Result<Vec<RepoFileTouches>, AppError> {
    tokio::task::spawn_blocking(move || paths.iter().map(|p| repo_file_touches_cached(p, FILE_TOUCHES_LIMIT)).collect())
        .await
        .map_err(|e| AppError::Channel(e.to_string()))
}
