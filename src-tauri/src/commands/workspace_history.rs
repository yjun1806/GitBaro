//! 워크스페이스 타임라인: 여러 저장소의 「HEAD 부터 main 과 갈라진 지점까지」 커밋.
//!
//! 저장소마다 따로 계산한다. 한 저장소가 실패해도 그 저장소의 `error` 만 채우고 나머지 결과는
//! 그대로 돌려준다. 브랜치 이름이 같아도 저장소를 합치지 않는다(요청한 경로마다 결과 하나).

use git2::{Oid, Repository, Sort};
use serde::Serialize;

use crate::error::AppError;
use crate::git::commit::{build_ref_map, commit_to_info};
use crate::git::merge_base::divergence_point;
use crate::git::CommitInfo;

/// `limit_per_repo` 를 주지 않았을 때 저장소마다 돌려줄 커밋 수.
pub const DEFAULT_LIMIT_PER_REPO: usize = 100;
/// 저장소마다 돌려줄 커밋 수의 상한.
pub const MAX_LIMIT_PER_REPO: usize = 1_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoHistory {
    /// 요청에 넘긴 저장소 경로 그대로.
    pub path: String,
    /// 체크아웃한 로컬 브랜치. detached HEAD 이거나 열지 못하면 `None`.
    pub branch: Option<String>,
    /// HEAD 커밋. 커밋이 없는(unborn) 저장소이거나 열지 못하면 `None`.
    pub head_oid: Option<String>,
    /// 기본 브랜치 이름(`main`). 찾지 못하면 `None`.
    pub default_branch: Option<String>,
    /// 실제로 비교한 참조(`main`, `origin/main`). `git::merge_base::divergence_point` 참고.
    pub base_ref: Option<String>,
    /// main 과 갈라진 지점. 없으면(기본 브랜치 없음, 이력 공유 안 함) `commits` 는 HEAD 의
    /// 이력을 `limit` 까지 담는다.
    pub merge_base_oid: Option<String>,
    /// HEAD 부터 갈라진 지점 바로 위까지, 최신 순. 갈라진 지점 커밋은 넣지 않는다.
    pub commits: Vec<CommitInfo>,
    /// 커밋이 `limit` 보다 많아 잘렸는가.
    pub truncated: bool,
    /// 이 저장소를 읽지 못한 이유. 있으면 나머지 필드는 비어 있다.
    pub error: Option<String>,
}

impl RepoHistory {
    fn failed(path: &str, error: String) -> Self {
        RepoHistory {
            path: path.to_string(),
            branch: None,
            head_oid: None,
            default_branch: None,
            base_ref: None,
            merge_base_oid: None,
            commits: Vec::new(),
            truncated: false,
            error: Some(error),
        }
    }
}

/// 저장소 하나의 타임라인. 실패해도 `error` 를 채운 결과를 돌려준다.
pub fn repo_history(path: &str, limit: usize) -> RepoHistory {
    read_repo_history(path, limit).unwrap_or_else(|e| {
        tracing::warn!("[workspace] history skipped {}: {}", path, e);
        RepoHistory::failed(path, e.message().to_string())
    })
}

fn read_repo_history(path: &str, limit: usize) -> Result<RepoHistory, git2::Error> {
    let repo = Repository::open(path)?;
    let head_ref = match repo.head() {
        Ok(head) => head,
        // 커밋이 하나도 없는 저장소: 보여 줄 커밋이 없을 뿐 실패는 아니다.
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => {
            return Ok(RepoHistory { error: None, ..RepoHistory::failed(path, String::new()) });
        }
        Err(e) => return Err(e),
    };
    let head = head_ref.peel_to_commit()?.id();
    let branch = head_ref.is_branch().then(|| head_ref.shorthand().map(str::to_string)).flatten();

    let point = divergence_point(&repo, head, branch.as_deref());
    let (commits, truncated) = commits_since(&repo, head, point.merge_base, limit)?;

    Ok(RepoHistory {
        path: path.to_string(),
        branch,
        head_oid: Some(head.to_string()),
        default_branch: point.default_branch,
        base_ref: point.base_ref,
        merge_base_oid: point.merge_base.map(|o| o.to_string()),
        commits,
        truncated,
        error: None,
    })
}

/// `head` 에서 닿되 `stop` 에서 닿지 않는 커밋(`stop..head`)을 최신 순으로 `limit` 개까지.
fn commits_since(
    repo: &Repository,
    head: Oid,
    stop: Option<Oid>,
    limit: usize,
) -> Result<(Vec<CommitInfo>, bool), git2::Error> {
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    walk.push(head)?;
    if let Some(stop) = stop {
        walk.hide(stop)?;
    }

    let ref_map = build_ref_map(repo);
    let mut commits = Vec::new();
    let mut truncated = false;
    for oid in walk {
        let oid = oid?;
        if commits.len() == limit {
            truncated = true;
            break;
        }
        let commit = repo.find_commit(oid)?;
        let refs = ref_map.get(&oid).cloned().unwrap_or_default();
        commits.push(CommitInfo { refs, ..commit_to_info(&commit) });
    }
    Ok((commits, truncated))
}

/// 저장소마다 HEAD 부터 main 과 갈라진 지점까지의 커밋. 결과는 `paths` 순서와 같다.
#[tauri::command]
pub async fn get_workspace_history(
    paths: Vec<String>,
    limit_per_repo: Option<usize>,
) -> Result<Vec<RepoHistory>, AppError> {
    let limit = limit_per_repo.unwrap_or(DEFAULT_LIMIT_PER_REPO).clamp(1, MAX_LIMIT_PER_REPO);
    tokio::task::spawn_blocking(move || paths.iter().map(|p| repo_history(p, limit)).collect())
        .await
        .map_err(|e| AppError::Channel(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .expect("git 실행 실패");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
    }

    fn commit(dir: &Path, msg: &str) {
        git(dir, &["commit", "-q", "--allow-empty", "-m", msg]);
    }

    fn tmp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("gitbaro-wshistory-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn init(dir: &Path, default: &str) {
        std::fs::create_dir_all(dir).unwrap();
        git(dir, &["init", "-q", "-b", default]);
        git(dir, &["config", "user.email", "t@t"]);
        git(dir, &["config", "user.name", "t"]);
    }

    /// `main` 에 커밋 `base` 개, 그 위 `feat/x` 브랜치에 커밋 `ahead` 개. HEAD 는 `feat/x`.
    /// origin 이 없다(origin/HEAD 없음).
    fn repo_with_branch(dir: &Path, base: usize, ahead: usize) {
        init(dir, "main");
        for i in 0..base {
            commit(dir, &format!("main {i}"));
        }
        git(dir, &["checkout", "-q", "-b", "feat/x"]);
        for i in 0..ahead {
            commit(dir, &format!("feat {i}"));
        }
    }

    fn summaries(h: &RepoHistory) -> Vec<&str> {
        h.commits.iter().map(|c| c.summary.as_str()).collect()
    }

    fn head_of(dir: &Path, rev: &str) -> String {
        let out = Command::new("git").args(["rev-parse", rev]).current_dir(dir).output().unwrap();
        String::from_utf8(out.stdout).unwrap().trim().to_string()
    }

    #[test]
    fn two_repos_on_the_same_branch_name_stay_separate() {
        let root = tmp_dir("two");
        let a = root.join("a");
        let b = root.join("b");
        repo_with_branch(&a, 2, 1);
        repo_with_branch(&b, 1, 3);

        let paths = [a.to_str().unwrap(), b.to_str().unwrap()];
        let out: Vec<RepoHistory> = paths.iter().map(|p| repo_history(p, 100)).collect();

        assert_eq!(out.len(), 2);
        assert_eq!(out[0].path, paths[0]);
        assert_eq!(out[1].path, paths[1]);
        assert_eq!(out[0].branch.as_deref(), Some("feat/x"));
        assert_eq!(out[1].branch.as_deref(), Some("feat/x"));
        assert_eq!(summaries(&out[0]), vec!["feat 0"]);
        assert_eq!(summaries(&out[1]), vec!["feat 2", "feat 1", "feat 0"]);
        assert_eq!(out[0].merge_base_oid.as_deref(), Some(head_of(&a, "main").as_str()));
        assert_eq!(out[1].merge_base_oid.as_deref(), Some(head_of(&b, "main").as_str()));
        assert!(out.iter().all(|h| h.error.is_none() && !h.truncated));
    }

    #[test]
    fn a_repo_without_origin_head_falls_back_to_local_main() {
        let root = tmp_dir("no-origin");
        let dir = root.join("r");
        repo_with_branch(&dir, 1, 2);
        // main 이 갈라진 뒤로 더 나아가도, 갈라진 지점은 feat/x 가 떠난 커밋이다.
        let fork = head_of(&dir, "main");
        git(&dir, &["checkout", "-q", "main"]);
        commit(&dir, "main later");
        git(&dir, &["checkout", "-q", "feat/x"]);

        let h = repo_history(dir.to_str().unwrap(), 100);
        assert_eq!(h.default_branch.as_deref(), Some("main"));
        assert_eq!(h.base_ref.as_deref(), Some("main"));
        assert_eq!(h.merge_base_oid.as_deref(), Some(fork.as_str()));
        assert_eq!(summaries(&h), vec!["feat 1", "feat 0"]);
        assert_eq!(h.commits[0].refs.first().map(|r| r.name.as_str()), Some("feat/x"));
    }

    #[test]
    fn master_is_used_when_there_is_no_main() {
        let root = tmp_dir("master");
        let dir = root.join("r");
        init(&dir, "master");
        commit(&dir, "m 0");
        git(&dir, &["checkout", "-q", "-b", "topic"]);
        commit(&dir, "t 0");

        let h = repo_history(dir.to_str().unwrap(), 100);
        assert_eq!(h.default_branch.as_deref(), Some("master"));
        assert_eq!(summaries(&h), vec!["t 0"]);
    }

    #[test]
    fn origin_head_names_the_default_branch_even_when_it_is_not_main() {
        let root = tmp_dir("origin-head");
        let upstream = root.join("up");
        init(&upstream, "trunk");
        commit(&upstream, "trunk 0");
        let clone = root.join("clone");
        git(&root, &["clone", "-q", upstream.to_str().unwrap(), clone.to_str().unwrap()]);
        git(&clone, &["config", "user.email", "t@t"]);
        git(&clone, &["config", "user.name", "t"]);
        // main 이라는 이름의 다른 브랜치가 있어도 origin/HEAD(trunk)가 우선한다.
        git(&clone, &["checkout", "-q", "-b", "main"]);
        commit(&clone, "unrelated main");
        git(&clone, &["checkout", "-q", "-b", "feat", "origin/trunk"]);
        commit(&clone, "feat 0");
        // 로컬 trunk 를 지워도 origin/trunk 와 비교한다.
        git(&clone, &["branch", "-q", "-D", "trunk"]);

        let h = repo_history(clone.to_str().unwrap(), 100);
        assert_eq!(h.default_branch.as_deref(), Some("trunk"));
        assert_eq!(h.base_ref.as_deref(), Some("origin/trunk"));
        assert_eq!(summaries(&h), vec!["feat 0"]);
    }

    #[test]
    fn on_the_default_branch_unpushed_commits_are_listed() {
        let root = tmp_dir("on-main");
        let upstream = root.join("up");
        init(&upstream, "main");
        commit(&upstream, "main 0");
        let clone = root.join("clone");
        git(&root, &["clone", "-q", upstream.to_str().unwrap(), clone.to_str().unwrap()]);
        git(&clone, &["config", "user.email", "t@t"]);
        git(&clone, &["config", "user.name", "t"]);
        commit(&clone, "local 0");

        let h = repo_history(clone.to_str().unwrap(), 100);
        assert_eq!(h.branch.as_deref(), Some("main"));
        assert_eq!(h.base_ref.as_deref(), Some("origin/main"));
        assert_eq!(summaries(&h), vec!["local 0"]);
    }

    #[test]
    fn on_a_local_only_default_branch_there_is_nothing_since_the_fork() {
        let root = tmp_dir("local-main");
        let dir = root.join("r");
        init(&dir, "main");
        commit(&dir, "main 0");

        let h = repo_history(dir.to_str().unwrap(), 100);
        assert_eq!(h.merge_base_oid, h.head_oid);
        assert!(h.commits.is_empty());
        assert!(h.error.is_none());
    }

    #[test]
    fn one_failing_repo_does_not_drop_the_others() {
        let root = tmp_dir("fail");
        let good = root.join("good");
        repo_with_branch(&good, 1, 1);
        let missing = root.join("missing");

        let paths = [missing.to_str().unwrap(), good.to_str().unwrap()];
        let out: Vec<RepoHistory> = paths.iter().map(|p| repo_history(p, 100)).collect();

        assert_eq!(out.len(), 2);
        assert!(out[0].error.is_some());
        assert!(out[0].commits.is_empty());
        assert!(out[1].error.is_none());
        assert_eq!(summaries(&out[1]), vec!["feat 0"]);
    }

    #[test]
    fn the_limit_truncates_each_repo() {
        let root = tmp_dir("limit");
        let dir = root.join("r");
        repo_with_branch(&dir, 1, 5);

        let h = repo_history(dir.to_str().unwrap(), 3);
        assert_eq!(summaries(&h), vec!["feat 4", "feat 3", "feat 2"]);
        assert!(h.truncated);

        let exact = repo_history(dir.to_str().unwrap(), 5);
        assert_eq!(exact.commits.len(), 5);
        assert!(!exact.truncated);
    }

    #[test]
    fn an_empty_repo_is_not_an_error() {
        let root = tmp_dir("empty");
        let dir = root.join("r");
        init(&dir, "main");

        let h = repo_history(dir.to_str().unwrap(), 100);
        assert!(h.error.is_none());
        assert!(h.head_oid.is_none());
        assert!(h.commits.is_empty());
    }

    #[test]
    fn a_branch_with_unrelated_history_lists_its_own_history() {
        let root = tmp_dir("orphan");
        let dir = root.join("r");
        init(&dir, "main");
        commit(&dir, "main 0");
        git(&dir, &["checkout", "-q", "--orphan", "island"]);
        commit(&dir, "island 0");
        commit(&dir, "island 1");

        let h = repo_history(dir.to_str().unwrap(), 100);
        assert!(h.merge_base_oid.is_none());
        assert_eq!(summaries(&h), vec!["island 1", "island 0"]);
    }

    #[tokio::test]
    async fn the_command_keeps_request_order_and_clamps_the_limit() {
        let root = tmp_dir("command");
        let a = root.join("a");
        repo_with_branch(&a, 1, 2);
        let paths = vec![a.to_str().unwrap().to_string(), root.join("nope").to_str().unwrap().to_string()];

        let out = get_workspace_history(paths.clone(), Some(0)).await.unwrap();
        assert_eq!(out.iter().map(|h| h.path.clone()).collect::<Vec<_>>(), paths);
        assert_eq!(out[0].commits.len(), 1);
        assert!(out[0].truncated);
        assert!(out[1].error.is_some());
    }
}
