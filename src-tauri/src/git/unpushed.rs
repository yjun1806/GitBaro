//! 원격에 올리지 않은 커밋. 검토 기준 「원격에 없는 커밋」의 원천이다.
//!
//! `git rev-list HEAD --not --remotes`와 같다: HEAD에서 닿지만 어느 원격 추적 브랜치
//! (`refs/remotes/*`)에서도 닿지 않는 커밋. 추적 브랜치가 없어도(아직 publish 전) 센다.
//! 다른 원격 브랜치에 이미 올라간 커밋은 올린 것으로 본다.

use git2::{Oid, Repository};

use crate::git::walk::newest_first;

/// 세는 비용을 막으려고 이 개수에서 멈춘다. 원격이 있는데 한 번도 fetch하지 않은 큰 저장소 등.
pub const UNPUSHED_LIMIT: usize = 10_000;

/// HEAD 브랜치의 원격 상태.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnpushedSummary {
    /// 원격에 없는 커밋(최신 순, 많아야 `limit`개).
    pub oids: Vec<Oid>,
    /// 현재 브랜치에 추적 브랜치가 있다.
    pub has_upstream: bool,
    /// 원격 저장소가 하나라도 설정돼 있다. 없으면 올릴 곳이 없으므로 `oids`는 비어 있다.
    pub has_remote: bool,
}

/// `tips`에서 닿지만 어느 원격 추적 브랜치에서도 닿지 않는 커밋(최신 순, 많아야 `limit`개).
///
/// 규칙(원격 표시와 히스토리의 「올리지 않음」 표시가 함께 쓴다):
/// - 원격이 하나도 설정돼 있지 않으면 올릴 곳이 없으므로 비어 있다.
/// - `upstream`(추적 브랜치 끝)도 숨긴다. `branch.<x>.remote = .`처럼 추적 브랜치가 로컬
///   브랜치여도 거기 이미 있는 커밋은 올린 것으로 본다. 원격 추적 브랜치면 이미 숨긴 것과 같다.
/// - 원격은 있지만 아직 fetch하지 않아 원격 추적 브랜치가 없으면 모든 커밋이 원격에 없다.
///   이때는 숨길 것이 없으므로 `limit`개만 읽고 멈춘다(`git::walk`).
pub fn commits_not_on_any_remote(
    repo: &Repository,
    tips: &[Oid],
    upstream: Option<Oid>,
    limit: usize,
) -> Result<Vec<Oid>, git2::Error> {
    if tips.is_empty() || repo.remotes()?.is_empty() {
        return Ok(Vec::new());
    }
    let has_remote_refs = repo.references_glob("refs/remotes/*")?.next().is_some();
    if !has_remote_refs && upstream.is_none() {
        return newest_first(repo, tips, limit);
    }
    // 숨길 커밋이 있으면 libgit2가 원격에 없는 커밋을 모두 모은 뒤에 내준다. 정렬은 하지 않는다:
    // 모으는 순서가 이미 커밋 시각 순이고, 위상 정렬은 한 번 더 전체를 훑는다.
    let mut walk = repo.revwalk()?;
    for tip in tips {
        walk.push(*tip)?;
    }
    if let Some(upstream) = upstream {
        walk.hide(upstream)?;
    }
    walk.hide_glob("refs/remotes/*")?;
    walk.take(limit).collect()
}

/// 로컬 브랜치의 추적 브랜치 끝. 추적 브랜치가 없거나 사라졌으면 `None`.
pub fn upstream_tip(branch: &git2::Branch) -> Option<Oid> {
    branch.upstream().ok().and_then(|up| up.get().target())
}

/// 지금 체크아웃한 HEAD 기준 요약. HEAD가 없으면(빈 저장소) 빈 목록이다.
/// 분리된 HEAD도 센다(추적 브랜치는 없다고 본다).
pub fn head_unpushed(repo: &Repository, limit: usize) -> Result<UnpushedSummary, git2::Error> {
    let has_remote = !repo.remotes()?.is_empty();
    let head = repo.head().ok();
    let branch = head
        .as_ref()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand())
        .and_then(|name| repo.find_branch(name, git2::BranchType::Local).ok());
    let has_upstream = branch.as_ref().is_some_and(|b| b.upstream().is_ok());
    let upstream = branch.as_ref().and_then(upstream_tip);
    let tips: Vec<Oid> = head.and_then(|h| h.target()).into_iter().collect();
    let oids = commits_not_on_any_remote(repo, &tips, upstream, limit)?;
    Ok(UnpushedSummary { oids, has_upstream, has_remote })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .expect("git 실행 실패");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn commit(dir: &Path, msg: &str) -> Oid {
        git(dir, &["commit", "-q", "--allow-empty", "-m", msg]);
        Oid::from_str(&git(dir, &["rev-parse", "HEAD"])).unwrap()
    }

    /// 원격(bare)과 그것을 clone한 작업 폴더. 원격 main에는 커밋 1개가 있다.
    fn clone_pair(name: &str) -> PathBuf {
        let tmp = std::env::temp_dir().join(format!("gitbaro-unpushed-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let seed = tmp.join("seed");
        std::fs::create_dir_all(&seed).unwrap();
        git(&seed, &["init", "-q", "-b", "main"]);
        git(&seed, &["config", "user.email", "t@t"]);
        git(&seed, &["config", "user.name", "t"]);
        commit(&seed, "init");
        git(&tmp, &["clone", "-q", "--bare", "seed", "origin.git"]);
        git(&tmp, &["clone", "-q", "origin.git", "work"]);
        let work = tmp.join("work");
        git(&work, &["config", "user.email", "t@t"]);
        git(&work, &["config", "user.name", "t"]);
        work
    }

    fn summary(dir: &Path) -> UnpushedSummary {
        head_unpushed(&Repository::open(dir).unwrap(), UNPUSHED_LIMIT).unwrap()
    }

    #[test]
    fn branch_without_upstream_counts_commits_missing_from_every_remote() {
        let work = clone_pair("no-upstream");
        git(&work, &["checkout", "-q", "-b", "feat/x"]);
        let a = commit(&work, "a");
        let b = commit(&work, "b");
        let s = summary(&work);
        assert!(!s.has_upstream, "publish 전");
        assert!(s.has_remote);
        assert_eq!(s.oids, vec![b, a], "최신 순, 원격 main의 커밋은 빠진다");
    }

    #[test]
    fn partially_pushed_branch_counts_only_the_rest() {
        let work = clone_pair("partial");
        git(&work, &["checkout", "-q", "-b", "feat/x"]);
        commit(&work, "a");
        git(&work, &["push", "-q", "-u", "origin", "feat/x"]);
        let b = commit(&work, "b");
        let s = summary(&work);
        assert!(s.has_upstream);
        assert_eq!(s.oids, vec![b]);
    }

    #[test]
    fn fully_pushed_branch_has_nothing_to_push() {
        let work = clone_pair("full");
        commit(&work, "a");
        git(&work, &["push", "-q", "origin", "main"]);
        let s = summary(&work);
        assert!(s.has_upstream);
        assert!(s.oids.is_empty());
    }

    #[test]
    fn commits_on_another_remote_branch_count_as_pushed() {
        let work = clone_pair("other-branch");
        git(&work, &["checkout", "-q", "-b", "feat/a"]);
        commit(&work, "shared");
        // 같은 커밋을 다른 이름의 원격 브랜치로 올린다.
        git(&work, &["push", "-q", "origin", "feat/a:refs/heads/backup"]);
        let mine = commit(&work, "mine");
        let s = summary(&work);
        assert!(!s.has_upstream);
        assert_eq!(s.oids, vec![mine], "backup 브랜치에 있는 커밋은 올린 것으로 본다");
    }

    #[test]
    fn repository_without_any_remote_reports_nothing() {
        let work = clone_pair("no-remote");
        git(&work, &["remote", "remove", "origin"]);
        commit(&work, "a");
        let s = summary(&work);
        assert!(!s.has_remote);
        assert!(s.oids.is_empty(), "올릴 곳이 없으면 세지 않는다");
    }

    #[test]
    fn a_never_fetched_remote_counts_only_up_to_the_limit() {
        use crate::git::walk::tests::{delete_commit_object, git as git_in, linear_repo};
        let dir = std::env::temp_dir()
            .join(format!("gitbaro-unpushed-never-fetched-{}", std::process::id()));
        let oids = linear_repo(&dir, 10);
        git_in(&dir, &["remote", "add", "origin", "https://example.invalid/r.git"]);
        // 한도 밖의 오래된 커밋이 깨져 있다. 전체를 훑으면 실패한다.
        delete_commit_object(&dir, oids[6]);
        let repo = Repository::open(&dir).unwrap();
        let s = head_unpushed(&repo, 3).unwrap();
        assert_eq!(s.oids, oids[..3].to_vec());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_local_upstream_counts_as_pushed() {
        // branch.<x>.remote = . : 추적 브랜치가 로컬 main이다.
        let work = clone_pair("local-upstream");
        git(&work, &["checkout", "-q", "-b", "feat/x"]);
        commit(&work, "on main too");
        git(&work, &["branch", "-f", "main", "HEAD"]);
        git(&work, &["branch", "-q", "--set-upstream-to=main"]);
        let mine = commit(&work, "mine");
        let s = summary(&work);
        assert!(s.has_upstream);
        assert_eq!(s.oids, vec![mine], "로컬 추적 브랜치에 있는 커밋은 올린 것으로 본다");
    }

    #[test]
    fn limit_caps_the_list() {
        let work = clone_pair("limit");
        for i in 0..5 {
            commit(&work, &format!("c{i}"));
        }
        let repo = Repository::open(&work).unwrap();
        let s = head_unpushed(&repo, 3).unwrap();
        assert_eq!(s.oids.len(), 3);
    }
}
