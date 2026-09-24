//! 원격에 올리지 않은 커밋. 검토 기준 「원격에 없는 커밋」의 원천이다.
//!
//! `git rev-list HEAD --not --remotes`와 같다: HEAD에서 닿지만 어느 원격 추적 브랜치
//! (`refs/remotes/*`)에서도 닿지 않는 커밋. 추적 브랜치가 없어도(아직 publish 전) 센다.
//! 다른 원격 브랜치에 이미 올라간 커밋은 올린 것으로 본다.

use git2::{Oid, Repository};

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

/// `tip`에서 닿지만 어느 원격 추적 브랜치에서도 닿지 않는 커밋(최신 순, 많아야 `limit`개).
pub fn commits_not_on_any_remote(repo: &Repository, tip: Oid, limit: usize) -> Result<Vec<Oid>, git2::Error> {
    let mut walk = repo.revwalk()?;
    walk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;
    walk.push(tip)?;
    // 추적 브랜치가 하나도 없으면 아무것도 숨기지 않는다(모든 커밋이 원격에 없다).
    walk.hide_glob("refs/remotes/*")?;
    walk.take(limit).collect()
}

/// 지금 체크아웃한 HEAD 기준 요약. HEAD가 없으면(빈 저장소) 빈 목록이다.
/// 분리된 HEAD도 센다(추적 브랜치는 없다고 본다).
pub fn head_unpushed(repo: &Repository, limit: usize) -> Result<UnpushedSummary, git2::Error> {
    let has_remote = !repo.remotes()?.is_empty();
    let head = repo.head().ok();
    let has_upstream = head
        .as_ref()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand())
        .and_then(|name| repo.find_branch(name, git2::BranchType::Local).ok())
        .is_some_and(|b| b.upstream().is_ok());
    let tip = head.and_then(|h| h.target());
    let oids = match (has_remote, tip) {
        (true, Some(tip)) => commits_not_on_any_remote(repo, tip, limit)?,
        _ => Vec::new(),
    };
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
