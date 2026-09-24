//! 저장소의 기본 브랜치(main)와 HEAD 가 갈라진 지점을 찾는다.
//!
//! 워크스페이스 타임라인(`commands::workspace_history`)이 「HEAD 부터 main 과 갈라진 지점까지」의
//! 커밋을 고르는 데 쓴다. 저장소마다 따로 계산하며, 다른 저장소와 브랜치 이름을 비교하지 않는다.
//!
//! 기본 브랜치를 고르는 순서는 `worktree_base::inference_candidates` 와 같다.
//! 1. origin/HEAD 가 가리키는 브랜치(`worktree_base::default_branch_name`).
//! 2. 없으면 로컬 `main`, `master` 중 있는 것.
//! 3. 로컬에도 없으면 `origin/main`, `origin/master` 중 있는 것(로컬 브랜치를 지운 클론).

use git2::{BranchType, Oid, Repository};

use crate::git::worktree_base::default_branch_name;

const FALLBACK_DEFAULTS: [&str; 2] = ["main", "master"];

/// HEAD 와 기본 브랜치가 갈라진 지점.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DivergencePoint {
    /// 저장소의 기본 브랜치 이름(`main`). 찾지 못하면 `None`.
    pub default_branch: Option<String>,
    /// 실제로 비교한 참조(`main`, `origin/main`). HEAD 가 기본 브랜치 자신이면 그 원격 추적 브랜치다.
    pub base_ref: Option<String>,
    /// HEAD 와 `base_ref` 의 공통 조상. 비교할 참조가 없거나 공통 조상이 없으면 `None`.
    pub merge_base: Option<Oid>,
}

/// 이 저장소의 기본 브랜치 이름. 규칙은 모듈 설명 참고.
pub fn default_branch(repo: &Repository) -> Option<String> {
    default_branch_name(repo)
        .or_else(|| {
            FALLBACK_DEFAULTS
                .into_iter()
                .find(|n| repo.find_branch(n, BranchType::Local).is_ok())
                .map(str::to_string)
        })
        .or_else(|| {
            FALLBACK_DEFAULTS
                .into_iter()
                .find(|n| repo.find_branch(&format!("origin/{n}"), BranchType::Remote).is_ok())
                .map(str::to_string)
        })
}

/// `head` 와 기본 브랜치가 갈라진 지점.
///
/// - HEAD 가 다른 브랜치(또는 detached)면 로컬 기본 브랜치와 비교하고, 로컬에 없으면
///   `origin/<기본 브랜치>` 와 비교한다.
/// - HEAD 가 기본 브랜치 자신이면 그 upstream(없으면 `origin/<기본 브랜치>`)과 비교한다.
///   아직 push 하지 않은 커밋이 「main 에서 갈라진 뒤의 커밋」이 된다. 원격 사본이 없으면
///   갈라진 지점은 HEAD 자신이다.
pub fn divergence_point(repo: &Repository, head: Oid, head_branch: Option<&str>) -> DivergencePoint {
    let default = default_branch(repo);
    let on_default = default.is_some() && default.as_deref() == head_branch;

    let base = default.as_deref().and_then(|name| {
        if on_default {
            upstream_ref(repo, name).or_else(|| remote_ref(repo, name))
        } else {
            local_ref(repo, name).or_else(|| remote_ref(repo, name))
        }
    });

    let (base_ref, merge_base) = match base {
        Some((name, oid)) => (Some(name), repo.merge_base(head, oid).ok()),
        None if on_default => (None, Some(head)),
        None => (None, None),
    };

    DivergencePoint { default_branch: default, base_ref, merge_base }
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
