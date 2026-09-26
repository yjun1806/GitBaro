//! Pull request 화면(읽기 전용)의 명령. GitHub 호출은 저장소에 지정된 계정의 토큰으로 하고,
//! 401 이면 토큰을 새로 받아 한 번만 다시 부른다(`call_with_token_retry`).
//!
//! 파일 diff 는 base·head 커밋이 로컬에 있으면 로컬 git 으로 만든다(원문이 있어 접힌 구간 펼치기와
//! 문서 보기가 된다). 없으면 화면이 GitHub patch(`list_pull_request_files` 의 `hunks`)를 쓴다.

use git2::{Oid, Repository};

use crate::commands::auth::{call_with_token_retry, resolve_repo_owner};
use crate::error::AppError;
use crate::git::file_diff::{tree_file_diff, TreeFileDiff};
use crate::github::client::GitHubClient;
use crate::github::pr_parse::{self, PrFiles, PullRequestDetail, PullRequestSummary};
use crate::github::pull_request::{self, PrStateFilter};
use crate::state::token_store::TokenStore;

async fn owner_of(repo_path: &str) -> Result<(String, String), AppError> {
    resolve_repo_owner(repo_path)
        .await
        .ok_or_else(|| AppError::Auth("Could not resolve owner/repo from remote URL".into()))
}

/// 저장소의 PR 목록. `state`: `open`(기본) | `closed` | `all`. `force` 면 잠깐 들고 있던 답을 버린다.
#[tauri::command]
pub async fn list_pull_requests(
    repo_path: String,
    account_id: String,
    state: String,
    force: Option<bool>,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<Vec<PullRequestSummary>, AppError> {
    let (owner, repo) = owner_of(&repo_path).await?;
    let filter = PrStateFilter::parse(&state);
    let force = force.unwrap_or(false);
    let client = GitHubClient::new();
    let data = call_with_token_retry(&token_store, &account_id, |token| {
        let (client, owner, repo) = (&client, &owner, &repo);
        async move { pull_request::list_pull_requests(client, &token, owner, repo, filter, force).await }
    })
    .await?;
    Ok(pr_parse::parse_pr_list(&data))
}

/// PR 하나의 상세. base·head 커밋이 로컬에 있으면 `localDiff` 가 true 다.
#[tauri::command]
pub async fn get_pull_request(
    repo_path: String,
    account_id: String,
    number: u64,
    force: Option<bool>,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<PullRequestDetail, AppError> {
    let (owner, repo) = owner_of(&repo_path).await?;
    let force = force.unwrap_or(false);
    let client = GitHubClient::new();
    let data = call_with_token_retry(&token_store, &account_id, |token| {
        let (client, owner, repo) = (&client, &owner, &repo);
        async move { pull_request::get_pull_request(client, &token, owner, repo, number, force).await }
    })
    .await?;
    let mut detail = pr_parse::parse_pr_detail(&data)?;

    let (base, head) = (detail.base_sha.clone(), detail.summary.head_sha.clone());
    detail.local_diff = tokio::task::spawn_blocking(move || has_commits(&repo_path, &[&base, &head]))
        .await
        .unwrap_or(false);
    Ok(detail)
}

/// PR 의 바뀐 파일과 GitHub patch.
#[tauri::command]
pub async fn list_pull_request_files(
    repo_path: String,
    account_id: String,
    number: u64,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<PrFiles, AppError> {
    let (owner, repo) = owner_of(&repo_path).await?;
    let client = GitHubClient::new();
    let (items, truncated) = call_with_token_retry(&token_store, &account_id, |token| {
        let (client, owner, repo) = (&client, &owner, &repo);
        async move { pull_request::list_pull_request_files(client, &token, owner, repo, number).await }
    })
    .await?;
    Ok(pr_parse::parse_pr_files(&items, truncated))
}

/// PR 파일 하나의 로컬 diff: base 와 head 의 공통 조상 → head. GitHub 의 PR diff 와 같은 범위다.
#[tauri::command]
pub async fn get_pull_request_file_diff(
    repo_path: String,
    base_sha: String,
    head_sha: String,
    file_path: String,
    old_path: Option<String>,
) -> Result<TreeFileDiff, AppError> {
    tokio::task::spawn_blocking(move || {
        local_file_diff(&repo_path, &base_sha, &head_sha, &file_path, old_path.as_deref())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

fn has_commits(repo_path: &str, shas: &[&str]) -> bool {
    let Ok(repo) = Repository::open(repo_path) else {
        return false;
    };
    shas.iter()
        .all(|sha| Oid::from_str(sha).is_ok_and(|oid| repo.find_commit(oid).is_ok()))
}

pub(crate) fn local_file_diff(
    repo_path: &str,
    base_sha: &str,
    head_sha: &str,
    file_path: &str,
    old_path: Option<&str>,
) -> Result<TreeFileDiff, AppError> {
    let repo = Repository::open(repo_path)?;
    let head = Oid::from_str(head_sha)?;
    let base = Oid::from_str(base_sha)?;
    let (merge_base, is_merge_base) = match repo.merge_base(head, base) {
        Ok(oid) => (oid, true),
        Err(e) if e.code() == git2::ErrorCode::NotFound => (base, false),
        Err(e) => return Err(e.into()),
    };
    let old_tree = repo.find_commit(merge_base)?.tree()?;
    let new_tree = repo.find_commit(head)?.tree()?;
    tree_file_diff(&repo, Some(&old_tree), &new_tree, file_path, old_path, Some(merge_base), is_merge_base)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    /// 끝나면(테스트가 실패해도) 지우는 임시 폴더.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            // 시계만으로는 같은 순간에 도는 테스트끼리 이름이 겹칠 수 있어 번호를 붙인다.
            static SEQ: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!("gitbaro-pr-{}-{}-{}", std::process::id(), nanos, seq));
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@example.com")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@example.com")
            .output()
            .expect("git runs");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    /// main: a.txt(1..3) → feature 가 3번째 줄을 바꾸고, 그 뒤 main 이 b.txt 를 더한다.
    fn repo_with_pr() -> (TempDir, String, String) {
        let dir = TempDir::new();
        let p = dir.path();
        git(p, &["init", "-q", "-b", "main"]);
        std::fs::write(p.join("a.txt"), "1\n2\n3\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-q", "-m", "base"]);
        git(p, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(p.join("a.txt"), "1\n2\nthree\n").unwrap();
        git(p, &["commit", "-q", "-am", "change"]);
        let head = git(p, &["rev-parse", "HEAD"]);
        git(p, &["checkout", "-q", "main"]);
        std::fs::write(p.join("b.txt"), "main only\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-q", "-m", "main moves on"]);
        let base = git(p, &["rev-parse", "HEAD"]);
        (dir, base, head)
    }

    #[test]
    fn local_diff_compares_from_the_merge_base() {
        let (dir, base, head) = repo_with_pr();
        let path = dir.path().to_str().unwrap();
        let diff = local_file_diff(path, &base, &head, "a.txt", None).unwrap();
        assert!(diff.base_is_merge_base);
        assert_eq!((diff.insertions, diff.deletions), (1, 1));
        assert_eq!(diff.old_content, "1\n2\n3\n");
        assert_eq!(diff.new_content, "1\n2\nthree\n");
        // main 에만 생긴 파일은 PR 의 변경이 아니다.
        let other = local_file_diff(path, &base, &head, "b.txt", None).unwrap();
        assert!(other.hunks.is_empty());
    }

    #[test]
    fn commits_must_all_exist_locally() {
        let (dir, base, head) = repo_with_pr();
        let path = dir.path().to_str().unwrap();
        assert!(has_commits(path, &[&base, &head]));
        assert!(!has_commits(path, &[&base, "0123456789abcdef0123456789abcdef01234567"]));
        assert!(!has_commits(path, &[&base, "not-a-sha"]));
    }

    #[test]
    fn local_diff_rejects_paths_outside_the_repo() {
        let (dir, base, head) = repo_with_pr();
        let path = dir.path().to_str().unwrap();
        assert!(local_file_diff(path, &base, &head, "../etc/passwd", None).is_err());
    }
}
