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
