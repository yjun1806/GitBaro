//! 원격에 올리지 않은 커밋 목록. push 확인 창이 무엇이 올라가는지 보여 주는 데 쓴다.

use crate::error::AppError;
use crate::git::commit::commit_to_info;
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
