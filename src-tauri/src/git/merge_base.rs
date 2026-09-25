//! 저장소의 기본 브랜치(main)와 HEAD 가 갈라진 지점을 찾는다.
//!
//! 워크스페이스 타임라인(`commands::workspace_history`)이 「HEAD 부터 main 과 갈라진 지점까지」의
//! 커밋을 고르는 데 쓴다. 저장소마다 따로 계산하며, 다른 저장소와 브랜치 이름을 비교하지 않는다.
//!
//! 기본 브랜치는 `worktree_base::default_branch_with_fallback` 으로 고른다. 워크트리 기반 추정,
//! 새 커밋 세기와 같은 규칙이다(origin/HEAD → 로컬 `main` → 로컬 `master`).

use git2::{BranchType, ErrorCode, Oid, Repository};
use serde::Serialize;

use crate::git::worktree_base::default_branch_with_fallback;

/// 갈라진 지점을 찾았는지, 못 찾았다면 왜인지.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BaseStatus {
    /// 갈라진 지점을 찾았다. 커밋 목록은 그 지점 바로 위에서 멈춘다.
    Found,
    /// 기본 브랜치가 없거나, 그 이름의 로컬·원격 브랜치가 없다.
    NoDefaultBranch,
    /// 기본 브랜치와 공통 조상이 없다(별도 이력).
    NoSharedHistory,
}

/// HEAD 와 기본 브랜치가 갈라진 지점.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DivergencePoint {
    /// 저장소의 기본 브랜치 이름(`main`). 찾지 못하면 `None`.
    pub default_branch: Option<String>,
    /// 갈라진 지점을 준 참조(`main`, `origin/main`). `status` 가 `Found` 가 아니면 `None`.
    pub base_ref: Option<String>,
    /// HEAD 와 `base_ref` 의 공통 조상. `status` 가 `Found` 일 때만 있다.
    pub merge_base: Option<Oid>,
    pub status: BaseStatus,
}

/// `head` 와 기본 브랜치가 갈라진 지점.
///
/// - HEAD 가 다른 브랜치(또는 detached)면 로컬 기본 브랜치와 `origin/<기본 브랜치>` 둘 다와
///   비교해 더 가까운(나중의) 공통 조상을 고른다. fetch 는 `origin/*` 만 옮기므로 로컬 main 이
///   뒤처져 있을 수 있고, 브랜치를 `origin/main` 에서 만들었다면 그쪽이 맞는 기준이다.
/// - HEAD 가 기본 브랜치 자신이면 그 upstream(없으면 `origin/<기본 브랜치>`)과 비교한다.
///   아직 push 하지 않은 커밋이 「main 에서 갈라진 뒤의 커밋」이 된다. 원격 사본이 없으면
///   갈라진 지점은 HEAD 자신이다.
///
/// 공통 조상이 없는 경우(`NotFound`)만 `NoSharedHistory` 로 보고, 그 밖의 libgit2 오류는 돌려준다.
pub fn divergence_point(
    repo: &Repository,
    head: Oid,
    head_branch: Option<&str>,
) -> Result<DivergencePoint, git2::Error> {
    let default = default_branch_with_fallback(repo);
    let Some(name) = default.as_deref() else {
        return Ok(unresolved(None, BaseStatus::NoDefaultBranch));
    };
    let on_default = head_branch == Some(name);

    let candidates: Vec<(String, Oid)> = if on_default {
        match upstream_ref(repo, name).or_else(|| remote_ref(repo, name)) {
            Some(r) => vec![r],
            // 원격 사본이 없는 기본 브랜치: 갈라진 뒤의 커밋이 없다.
            None => return Ok(found(default.clone(), name.to_string(), head)),
        }
    } else {
        [local_ref(repo, name), remote_ref(repo, name)].into_iter().flatten().collect()
    };
    if candidates.is_empty() {
        return Ok(unresolved(default, BaseStatus::NoDefaultBranch));
    }

    let mut nearest: Option<(String, Oid)> = None;
    for (ref_name, oid) in candidates {
        let base = match repo.merge_base(head, oid) {
            Ok(base) => base,
            Err(e) if e.code() == ErrorCode::NotFound => continue,
            Err(e) => return Err(e),
        };
        let closer = match &nearest {
            None => true,
            Some((_, current)) => repo.graph_descendant_of(base, *current)?,
        };
        if closer {
            nearest = Some((ref_name, base));
        }
    }

    Ok(match nearest {
        Some((ref_name, base)) => found(default, ref_name, base),
        None => unresolved(default, BaseStatus::NoSharedHistory),
    })
}

fn found(default_branch: Option<String>, base_ref: String, merge_base: Oid) -> DivergencePoint {
    DivergencePoint {
        default_branch,
        base_ref: Some(base_ref),
        merge_base: Some(merge_base),
        status: BaseStatus::Found,
    }
}

fn unresolved(default_branch: Option<String>, status: BaseStatus) -> DivergencePoint {
    DivergencePoint { default_branch, base_ref: None, merge_base: None, status }
}

fn local_ref(repo: &Repository, name: &str) -> Option<(String, Oid)> {
    let oid = repo.find_branch(name, BranchType::Local).ok()?.get().target()?;
    Some((name.to_string(), oid))
}

fn remote_ref(repo: &Repository, name: &str) -> Option<(String, Oid)> {
    let remote = format!("origin/{name}");
    let oid = repo.find_branch(&remote, BranchType::Remote).ok()?.get().target()?;
    Some((remote, oid))
}

fn upstream_ref(repo: &Repository, name: &str) -> Option<(String, Oid)> {
    let upstream = repo.find_branch(name, BranchType::Local).ok()?.upstream().ok()?;
    let upstream_name = upstream.name().ok().flatten()?.to_string();
    let oid = upstream.get().target()?;
    Some((upstream_name, oid))
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
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .output()
            .expect("git 실행 실패");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn commit(dir: &Path, msg: &str) -> Oid {
        git(dir, &["commit", "-q", "--allow-empty", "-m", msg]);
        Oid::from_str(&git(dir, &["rev-parse", "HEAD"])).unwrap()
    }

    /// 테스트가 끝나면(실패해도) 지우는 임시 저장소.
    struct TempRepo(PathBuf);

    impl TempRepo {
        fn new(name: &str, branch: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("gitbaro-mergebase-{}-{}", name, std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            git(&dir, &["init", "-q", "-b", branch]);
            TempRepo(dir)
        }

        fn point(&self) -> DivergencePoint {
            let repo = Repository::open(&self.0).unwrap();
            let head = repo.head().unwrap();
            let oid = head.target().unwrap();
            let branch = head.shorthand().map(str::to_string);
            divergence_point(&repo, oid, branch.as_deref()).unwrap()
        }
    }

    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_branch_off_main_diverges_at_the_fork_commit() {
        let r = TempRepo::new("found", "main");
        commit(&r.0, "m1");
        let fork = commit(&r.0, "m2");
        git(&r.0, &["checkout", "-q", "-b", "feat"]);
        commit(&r.0, "f1");
        git(&r.0, &["checkout", "-q", "main"]);
        commit(&r.0, "m3 after the fork");
        git(&r.0, &["checkout", "-q", "feat"]);

        let point = r.point();
        assert_eq!(point.status, BaseStatus::Found);
        assert_eq!(point.default_branch.as_deref(), Some("main"));
        assert_eq!(point.base_ref.as_deref(), Some("main"));
        assert_eq!(point.merge_base, Some(fork));
    }

    #[test]
    fn a_local_only_default_branch_diverges_at_head() {
        let r = TempRepo::new("on-default", "main");
        let head = commit(&r.0, "m1");
        let point = r.point();
        assert_eq!(point.status, BaseStatus::Found);
        assert_eq!(point.merge_base, Some(head), "원격 사본이 없으면 갈라진 뒤의 커밋이 없다");
    }

    #[test]
    fn without_main_master_or_origin_head_there_is_no_default_branch() {
        let r = TempRepo::new("no-default", "trunk");
        commit(&r.0, "t1");
        let point = r.point();
        assert_eq!(point.status, BaseStatus::NoDefaultBranch);
        assert_eq!(point.default_branch, None);
        assert_eq!((point.base_ref, point.merge_base), (None, None));
    }

    #[test]
    fn an_unrelated_history_has_no_shared_ancestor() {
        let r = TempRepo::new("unrelated", "main");
        commit(&r.0, "m1");
        git(&r.0, &["checkout", "-q", "--orphan", "other"]);
        commit(&r.0, "o1");

        let point = r.point();
        assert_eq!(point.status, BaseStatus::NoSharedHistory);
        assert_eq!(point.default_branch.as_deref(), Some("main"));
        assert_eq!((point.base_ref, point.merge_base), (None, None));
    }
}
