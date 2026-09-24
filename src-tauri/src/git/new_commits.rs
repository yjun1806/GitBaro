//! 워크트리마다 「마지막으로 확인한 커밋」(기준선) 뒤에 들어온 새 커밋을 센다.
//!
//! 기준선은 프론트엔드 스토어(`src/stores/review-seen.ts`, 저장 키 `gitbaro-review-seen`)가
//! 워크트리 경로별로 `{branch, oid, seenAt}` 형태로 기억한다. 이 모듈은 저장하지 않고,
//! 넘겨받은 기록으로 개수만 계산한다.
//!
//! 세는 방법(`CountBasis`):
//! 1. `oid` — 기준 SHA 가 HEAD 에서 닿으면 `oid..HEAD` 의 커밋 수.
//! 2. `authorTime` — rebase·amend 로 기준 SHA 가 HEAD 에서 닿지 않으면, 분기점..HEAD 범위에서
//!    author 시각이 `seenAt` 보다 늦은 커밋만 센다. rebase 는 author 시각을 보존하므로
//!    이미 본 커밋이 다시 새 커밋이 되지 않는다.
//! 3. `mergeBase` — 기록이 없거나 기록된 브랜치와 지금 브랜치가 다르면, 기반 브랜치에서
//!    갈라진 지점(merge-base)..HEAD 를 센다. 기반 브랜치는 `worktree_base` 로 판별한다.

use std::path::Path;

use git2::{BranchType, Oid, Repository};
use serde::{Deserialize, Serialize};

use crate::git::worktree_base::{default_branch_name, resolve_worktree_base_cached};

/// 한 번에 걷는 커밋 수의 상한. 오래 방치된 워크트리에서도 응답이 늦어지지 않게 한다.
pub const MAX_WALK: usize = 5_000;

/// 저장소 하나의 워크트리 목록(메인 작업 트리 포함).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoReviewStatus {
    /// 요청에 넘긴 저장소 경로 그대로.
    pub repo_path: String,
    pub worktrees: Vec<ReviewWorktree>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewWorktree {
    /// 작업 트리 경로(끝의 `/` 없음). 기준선 스토어의 키로 쓴다.
    pub path: String,
    /// 체크아웃한 로컬 브랜치. detached HEAD 면 `None`.
    pub branch: Option<String>,
    /// HEAD 커밋. 커밋이 하나도 없는(unborn) 저장소면 `None`.
    pub head_oid: Option<String>,
    pub is_main: bool,
}

/// 프론트엔드가 기억하는 기준선 하나. 기록이 없으면 `oid` 가 `None` 이다.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeenRecord {
    pub path: String,
    pub oid: Option<String>,
    /// 확인한 시각(epoch ms).
    pub seen_at: Option<i64>,
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CountBasis {
    Oid,
    AuthorTime,
    MergeBase,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCommitCount {
    pub path: String,
    pub head_oid: String,
    pub new_count: u32,
    pub basis: CountBasis,
}

// ── 워크트리 목록 ────────────────────────────────────────────────────────────

/// `repo_path`(메인 작업 트리든 링크된 워크트리든)가 속한 저장소의 모든 워크트리.
/// 메인 작업 트리가 맨 앞이다. bare 저장소는 메인 작업 트리가 없어 링크된 것만 돌려준다.
/// 작업 디렉토리가 사라진(prune 대기) 워크트리는 뺀다.
pub fn list_review_worktrees(repo_path: &str) -> Result<RepoReviewStatus, git2::Error> {
    let opened = Repository::open(repo_path)?;
    let main = if opened.is_worktree() {
        Repository::open(common_git_dir(&opened))?
    } else {
        opened
    };

    let mut worktrees = Vec::new();
    if let Some(workdir) = main.workdir() {
        let (branch, head_oid) = head_info(&main);
        worktrees.push(ReviewWorktree {
            path: normalize_path(workdir),
            branch,
            head_oid,
            is_main: true,
        });
    }

    let names = main.worktrees()?;
    for name in names.iter().flatten() {
        let Ok(wt) = main.find_worktree(name) else { continue };
        if wt.validate().is_err() {
            continue;
        }
        let Ok(repo) = Repository::open_from_worktree(&wt) else { continue };
        let (branch, head_oid) = head_info(&repo);
        worktrees.push(ReviewWorktree {
            path: normalize_path(wt.path()),
            branch,
            head_oid,
            is_main: false,
        });
    }

    Ok(RepoReviewStatus { repo_path: repo_path.to_string(), worktrees })
}

/// 링크된 워크트리의 `.git/worktrees/<name>/commondir` 가 가리키는 공용 git 디렉토리.
fn common_git_dir(repo: &Repository) -> std::path::PathBuf {
    let git_dir = repo.path();
    std::fs::read_to_string(git_dir.join("commondir"))
        .map(|rel| git_dir.join(rel.trim()))
        .unwrap_or_else(|_| git_dir.to_path_buf())
}

fn head_info(repo: &Repository) -> (Option<String>, Option<String>) {
    let Ok(head) = repo.head() else { return (None, None) };
    let branch = head.is_branch().then(|| head.shorthand().map(str::to_string)).flatten();
    let oid = head.target().map(|o| o.to_string());
    (branch, oid)
}

fn normalize_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    let trimmed = s.trim_end_matches('/');
    if trimmed.is_empty() { s.to_string() } else { trimmed.to_string() }
}

// ── 새 커밋 세기 ─────────────────────────────────────────────────────────────

/// `record.path` 워크트리의 새 커밋 수. HEAD 가 없으면(unborn) 에러.
pub fn count_new_commits(record: &SeenRecord) -> Result<NewCommitCount, git2::Error> {
    let repo = Repository::open(&record.path)?;
    let head_ref = repo.head()?;
    let head = head_ref.peel_to_commit()?.id();
    let branch = head_ref.is_branch().then(|| head_ref.shorthand().map(str::to_string)).flatten();

    let (new_count, basis) = count_for(&repo, head, branch.as_deref(), record)?;
    Ok(NewCommitCount {
        path: record.path.clone(),
        head_oid: head.to_string(),
        new_count,
        basis,
    })
}

fn count_for(
    repo: &Repository,
    head: Oid,
    branch: Option<&str>,
    record: &SeenRecord,
) -> Result<(u32, CountBasis), git2::Error> {
    let seen_oid = record.oid.as_deref().and_then(|s| Oid::from_str(s).ok());
    let same_branch = record.branch.as_deref() == branch;
    let Some(seen_oid) = seen_oid.filter(|_| same_branch) else {
        return merge_base_count(repo, head, branch);
    };

    if seen_oid == head || repo.graph_descendant_of(head, seen_oid).unwrap_or(false) {
        let n = count_range(repo, head, Some(seen_oid), |_| true)?;
        return Ok((n, CountBasis::Oid));
    }

    let Some(seen_at) = record.seen_at else {
        return merge_base_count(repo, head, branch);
    };
    // 분기점을 못 찾으면 옛 기준 커밋(아직 객체가 남아 있으면)과의 공통 조상을 쓴다.
    let lower = fork_point(repo, head, branch).or_else(|| repo.merge_base(head, seen_oid).ok());
    let n = count_range(repo, head, lower, |c| c.author().when().seconds().saturating_mul(1000) > seen_at)?;
    Ok((n, CountBasis::AuthorTime))
}

fn merge_base_count(
    repo: &Repository,
    head: Oid,
    branch: Option<&str>,
) -> Result<(u32, CountBasis), git2::Error> {
    // 기반 브랜치를 모르면 셀 범위가 없다. 전체 이력을 새 커밋이라 부르지 않도록 0 으로 둔다.
    let n = match fork_point(repo, head, branch) {
        Some(lower) => count_range(repo, head, Some(lower), |_| true)?,
        None => 0,
    };
    Ok((n, CountBasis::MergeBase))
}

/// HEAD 가 기반 브랜치에서 갈라진 지점. detached HEAD 면 기본 브랜치를 기반으로 본다.
fn fork_point(repo: &Repository, head: Oid, branch: Option<&str>) -> Option<Oid> {
    let base_name = match branch {
        Some(b) => resolve_worktree_base_cached(repo, b)?.name,
        None => default_branch_name(repo).or_else(|| {
            ["main", "master"]
                .into_iter()
                .find(|n| repo.find_branch(n, BranchType::Local).is_ok())
                .map(str::to_string)
        })?,
    };
    let base_oid = branch_oid(repo, &base_name)?;
    repo.merge_base(head, base_oid).ok()
}

fn branch_oid(repo: &Repository, name: &str) -> Option<Oid> {
    repo.find_branch(name, BranchType::Local)
        .or_else(|_| repo.find_branch(name, BranchType::Remote))
        .ok()?
        .get()
        .target()
}

/// `hide..head` 범위에서 `keep` 을 만족하는 커밋 수. 최대 `MAX_WALK` 개까지 걷는다.
fn count_range(
    repo: &Repository,
    head: Oid,
    hide: Option<Oid>,
    keep: impl Fn(&git2::Commit) -> bool,
) -> Result<u32, git2::Error> {
    let mut walk = repo.revwalk()?;
    walk.push(head)?;
    if let Some(hide) = hide {
        walk.hide(hide)?;
    }
    let mut n: u32 = 0;
    for oid in walk.take(MAX_WALK) {
        let commit = repo.find_commit(oid?)?;
        if keep(&commit) {
            n = n.saturating_add(1);
        }
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    /// 기준 시각(2023-11-14). 테스트 커밋의 author 시각은 여기서부터 1분씩 늘어난다.
    const T0: i64 = 1_700_000_000;

    /// `author`·`committer` 가 있으면 그 시각(epoch 초)으로 고정한다. 없으면 git 이 정한다.
    fn git_env(dir: &Path, args: &[&str], author: Option<i64>, committer: Option<i64>) -> String {
        let mut cmd = Command::new("git");
        cmd.args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null");
        if let Some(t) = author {
            cmd.env("GIT_AUTHOR_DATE", format!("@{} +0000", t));
        }
        if let Some(t) = committer {
            cmd.env("GIT_COMMITTER_DATE", format!("@{} +0000", t));
        }
        let out = cmd.output().expect("git 실행 실패");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn git(dir: &Path, args: &[&str]) -> String {
        git_env(dir, args, None, None)
    }

    /// author·committer 시각을 `T0 + minute * 60` 으로 고정한 커밋.
    fn commit_at(dir: &Path, msg: &str, minute: i64) {
        let t = Some(T0 + minute * 60);
        git_env(dir, &["commit", "-q", "--allow-empty", "-m", msg], t, t);
    }

    fn head(dir: &Path) -> String {
        git(dir, &["rev-parse", "HEAD"])
    }

    fn ms(minute: i64) -> i64 {
        (T0 + minute * 60) * 1000
    }

    /// main 에 커밋 1개가 있는 저장소. 반환값은 메인 작업 트리 경로.
    fn init_repo(name: &str) -> PathBuf {
        let tmp = std::env::temp_dir()
            .join(format!("gitbaro-newcommits-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let main = tmp.join("main");
        std::fs::create_dir_all(&main).unwrap();
        git(&main, &["init", "-q", "-b", "main"]);
        git(&main, &["config", "user.email", "t@t"]);
        git(&main, &["config", "user.name", "t"]);
        commit_at(&main, "init", 0);
        main.canonicalize().unwrap()
    }

    fn add_worktree(main: &Path, name: &str, branch: &str, from: &str) -> PathBuf {
        let wt = main.parent().unwrap().join(name);
        git(main, &["worktree", "add", "-q", "-b", branch, wt.to_str().unwrap(), from]);
        wt
    }

    fn record(path: &Path, oid: Option<&str>, seen_at: Option<i64>, branch: Option<&str>) -> SeenRecord {
        SeenRecord {
            path: path.to_str().unwrap().to_string(),
            oid: oid.map(str::to_string),
            seen_at,
            branch: branch.map(str::to_string),
        }
    }

    fn count(r: &SeenRecord) -> (u32, CountBasis) {
        let c = count_new_commits(r).unwrap();
        (c.new_count, c.basis)
    }

    #[test]
    fn lists_the_main_worktree_first_then_linked_ones() {
        let main = init_repo("list");
        let wt = add_worktree(&main, "wt-list", "feat/list", "main");
        commit_at(&wt, "feat 1", 1);

        let status = list_review_worktrees(main.to_str().unwrap()).unwrap();
        assert_eq!(status.repo_path, main.to_str().unwrap());
        assert_eq!(status.worktrees.len(), 2);

        let m = &status.worktrees[0];
        assert!(m.is_main);
        assert_eq!(m.path, main.to_str().unwrap());
        assert_eq!(m.branch.as_deref(), Some("main"));
        assert_eq!(m.head_oid.as_deref(), Some(head(&main).as_str()));

        let l = &status.worktrees[1];
        assert!(!l.is_main);
        assert_eq!(Path::new(&l.path).canonicalize().unwrap(), wt.canonicalize().unwrap());
        assert_eq!(l.branch.as_deref(), Some("feat/list"));
        assert_eq!(l.head_oid.as_deref(), Some(head(&wt).as_str()));

        // 링크된 워크트리 경로로 물어도 같은 저장소의 목록이 나온다.
        let from_wt = list_review_worktrees(wt.to_str().unwrap()).unwrap();
        assert_eq!(from_wt.worktrees.len(), 2);
        assert!(from_wt.worktrees[0].is_main);
        assert_eq!(from_wt.worktrees[0].path, main.to_str().unwrap());
    }

    #[test]
    fn a_detached_worktree_has_no_branch() {
        let main = init_repo("detached");
        git(&main, &["checkout", "-q", "--detach"]);
        let status = list_review_worktrees(main.to_str().unwrap()).unwrap();
        assert_eq!(status.worktrees[0].branch, None);
        assert!(status.worktrees[0].head_oid.is_some());
    }

    #[test]
    fn commits_added_one_after_another_are_counted_from_the_seen_oid() {
        let main = init_repo("sequential");
        let seen = head(&main);
        let r = record(&main, Some(&seen), Some(ms(0)), Some("main"));
        assert_eq!(count(&r), (0, CountBasis::Oid));

        commit_at(&main, "c1", 1);
        assert_eq!(count(&r), (1, CountBasis::Oid));
        commit_at(&main, "c2", 2);
        commit_at(&main, "c3", 3);
        assert_eq!(count(&r), (3, CountBasis::Oid));

        // 확인함으로 표시하면 다시 0 부터.
        let r = record(&main, Some(&head(&main)), Some(ms(10)), Some("main"));
        assert_eq!(count(&r), (0, CountBasis::Oid));
    }

    #[test]
    fn after_an_amend_it_falls_back_to_author_time() {
        let main = init_repo("amend");
        let wt = add_worktree(&main, "wt-amend", "feat/amend", "main");
        commit_at(&wt, "a1", 1);
        commit_at(&wt, "a2", 2);
        let r = record(&wt, Some(&head(&wt)), Some(ms(5)), Some("feat/amend"));

        // amend 는 author 시각을 그대로 두고 커밋 시각만 바꾼다. 이미 본 커밋이다.
        git_env(&wt, &["commit", "-q", "--amend", "--allow-empty", "-m", "a2'"], None, Some(T0 + 6 * 60));
        assert_eq!(git(&wt, &["log", "-1", "--format=%at"]), (T0 + 2 * 60).to_string());
        assert_eq!(count(&r), (0, CountBasis::AuthorTime));

        commit_at(&wt, "a3", 7);
        assert_eq!(count(&r), (1, CountBasis::AuthorTime));
    }

    #[test]
    fn rebasing_twenty_seen_commits_onto_a_newer_base_counts_zero() {
        let main = init_repo("rebase");
        let wt = add_worktree(&main, "wt-rebase", "feat/rebase", "main");
        for i in 1..=20 {
            commit_at(&wt, &format!("f{}", i), i);
        }
        let r = record(&wt, Some(&head(&wt)), Some(ms(30)), Some("feat/rebase"));
        assert_eq!(count(&r), (0, CountBasis::Oid));

        // main 이 앞서 나간 뒤(확인 시각보다 늦은 커밋) 그 위로 rebase 한다.
        commit_at(&main, "m2", 40);
        commit_at(&main, "m3", 41);
        git_env(&wt, &["rebase", "-q", "main"], None, Some(T0 + 50 * 60));
        assert_eq!(git(&wt, &["rev-list", "--count", "main..HEAD"]), "20");

        assert_eq!(count(&r), (0, CountBasis::AuthorTime));

        commit_at(&wt, "f21", 60);
        assert_eq!(count(&r), (1, CountBasis::AuthorTime));
    }

    #[test]
    fn a_branch_switch_counts_from_the_merge_base() {
        let main = init_repo("switch");
        let wt = add_worktree(&main, "wt-switch", "feat/a", "main");
        commit_at(&wt, "a1", 1);
        let r = record(&wt, Some(&head(&wt)), Some(ms(100)), Some("feat/a"));

        git(&wt, &["checkout", "-q", "-b", "feat/b", "main"]);
        commit_at(&wt, "b1", 2);
        commit_at(&wt, "b2", 3);
        // 기록 시각보다 이른 커밋이어도 브랜치가 바뀌었으니 분기점부터 모두 센다.
        assert_eq!(count(&r), (2, CountBasis::MergeBase));
    }

    #[test]
    fn a_new_worktree_without_a_record_counts_from_the_merge_base() {
        let main = init_repo("fresh");
        git(&main, &["branch", "dev"]);
        let wt = add_worktree(&main, "wt-fresh", "feat/agent", "dev");
        commit_at(&wt, "x1", 1);
        commit_at(&wt, "x2", 2);
        commit_at(&wt, "x3", 3);
        // 기반 브랜치가 앞서 나가도 갈라진 뒤의 이 브랜치 커밋만 센다.
        git(&main, &["checkout", "-q", "dev"]);
        commit_at(&main, "d1", 4);

        let r = record(&wt, None, None, None);
        assert_eq!(count(&r), (3, CountBasis::MergeBase));
    }

    #[test]
    fn a_record_without_seen_time_and_a_lost_oid_uses_the_merge_base() {
        let main = init_repo("noseen");
        let wt = add_worktree(&main, "wt-noseen", "feat/n", "main");
        commit_at(&wt, "n1", 1);
        let r = record(&wt, Some("0000000000000000000000000000000000000001"), None, Some("feat/n"));
        assert_eq!(count(&r), (1, CountBasis::MergeBase));
    }

    #[test]
    fn an_unborn_head_is_an_error() {
        let tmp = std::env::temp_dir().join(format!("gitbaro-newcommits-unborn-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        git(&tmp, &["init", "-q", "-b", "main"]);
        assert!(count_new_commits(&record(&tmp, None, None, None)).is_err());
        let status = list_review_worktrees(tmp.to_str().unwrap()).unwrap();
        assert_eq!(status.worktrees[0].head_oid, None);
    }
}
