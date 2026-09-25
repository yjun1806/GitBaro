//! 여러 저장소 Fetch·Pull·Push 확인 창(D3)에 보여 줄 저장소별 실행 계획.
//!
//! 저장소마다 따로 계산한다. 한 저장소를 읽지 못해도 그 저장소의 `skip_reason`·`error`만 채우고
//! 나머지 계획은 그대로 돌려준다. 계획은 로컬 상태(마지막 fetch 결과)만 읽는다. 원격에 새 커밋이
//! 있는지 알려면 호출 쪽이 먼저 fetch를 돌려야 한다(`fetched_at`으로 기준 시각을 알린다).
//!
//! 명령 문자열은 원격 **이름**과 브랜치로만 만든다. 원격 URL이나 토큰은 넣지 않는다.
//! 실제 실행은 기존 `git_fetch`·`git_pull`·`git_push` 명령이 저장소마다 따로 한다.
//! 원격 선택은 그 명령들이 쓰는 `commands/git.rs`의 `SyncTarget`을 그대로 불러 정한다.
//! 규칙을 따로 베끼지 않으므로 보여 주는 명령과 실제 실행이 어긋나지 않는다.

use std::path::Path;

use git2::{BranchType, Repository};
use serde::{Deserialize, Serialize};

use crate::commands::git::{sync_target_from_repo, SyncTarget};
use crate::error::AppError;
use crate::git::cli::pull_mode_flag;

/// 확인 창이 다루는 원격 작업.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RemotePlanOp {
    Fetch,
    Pull,
    Push,
}

/// 저장소를 이번 작업에서 뺀 이유.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RemotePlanSkipReason {
    /// Push: 보낼 커밋이 없다. Pull: 받을 커밋이 없다.
    UpToDate,
    /// Pull: 추적 브랜치가 없다.
    NoUpstream,
    /// Pull: 추적 브랜치는 설정돼 있지만 그 원격 브랜치가 사라졌다(원격에서 지운 뒤 fetch --prune).
    UpstreamGone,
    /// Pull: 추적 브랜치가 설정돼 있지만 이 클론의 fetch refspec 이 그 브랜치를 받지 않는다
    /// (`--single-branch`·얕은 클론). 원격에는 있을 수 있다.
    NotTracked,
    /// 체크아웃한 브랜치가 없다(detached HEAD).
    DetachedHead,
    /// 커밋이 하나도 없는 저장소.
    Unborn,
    /// 원격이 없다.
    NoRemote,
    /// origin이 없고 원격이 여러 개라 어디로 보낼지 정할 수 없다.
    MultipleRemotes,
    /// 저장소를 열거나 읽지 못했다(`error`에 이유).
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRemotePlan {
    /// 요청에 넘긴 저장소 경로 그대로.
    pub path: String,
    /// 체크아웃한 로컬 브랜치.
    pub branch: Option<String>,
    /// 작업할 원격 이름(fetch는 첫 번째 원격).
    pub remote: Option<String>,
    /// 이 저장소에서 실행할 git 명령. 원격이 둘인 fetch는 ` && `로 잇는다. 뺀 저장소도
    /// 명령을 알 수 있으면 채운다(흐리게 보여 준다).
    pub command: Option<String>,
    /// Push: 올릴 커밋 수. Pull: 받을 커밋 수. Fetch: 0.
    pub commits: u32,
    /// 원격 브랜치에만 있는 커밋 수(마지막 fetch 기준). Push의 「먼저 Pull 필요」 안내에 쓴다.
    pub behind: u32,
    /// 원격 브랜치에 로컬에 없는 커밋이 있다(마지막 fetch 기준). Push는 먼저 Pull이 필요하다.
    pub needs_pull: bool,
    /// Push가 추적 브랜치를 새로 연결하거나 바꾼다(`-u`).
    pub sets_upstream: bool,
    /// 이번 작업에서 뺀다. 확인 창에서 체크를 풀고 흐리게 보여 준다.
    pub skip: bool,
    pub skip_reason: Option<RemotePlanSkipReason>,
    /// 마지막으로 **성공한** fetch 시각(유닉스 초). 내용이 있는 `FETCH_HEAD`의 수정 시각이다.
    /// 실패한 fetch는 `FETCH_HEAD`를 빈 파일로 덮어쓰므로, 비어 있거나 없으면 `None`(시각 모름).
    pub fetched_at: Option<i64>,
    /// `skip_reason`이 `error`일 때 이유.
    pub error: Option<String>,
}

impl RepoRemotePlan {
    fn empty(path: &str) -> Self {
        Self {
            path: path.to_string(),
            branch: None,
            remote: None,
            command: None,
            commits: 0,
            behind: 0,
            needs_pull: false,
            sets_upstream: false,
            skip: false,
            skip_reason: None,
            fetched_at: None,
            error: None,
        }
    }

    fn skipped(self, reason: RemotePlanSkipReason) -> Self {
        Self {
            skip: true,
            skip_reason: Some(reason),
            ..self
        }
    }
}

/// 저장소마다 `op`을 실행하면 무엇이 일어날지 계산한다. 결과는 `paths` 순서 그대로다.
#[tauri::command]
pub async fn plan_remote_op(
    paths: Vec<String>,
    op: RemotePlanOp,
) -> Result<Vec<RepoRemotePlan>, AppError> {
    tokio::task::spawn_blocking(move || paths.iter().map(|p| plan_repo(p, op)).collect())
        .await
        .map_err(|e| AppError::Channel(e.to_string()))
}

/// 저장소 하나의 계획. 실패는 결과 안에 담고 에러로 올리지 않는다.
pub(crate) fn plan_repo(path: &str, op: RemotePlanOp) -> RepoRemotePlan {
    let base = RepoRemotePlan::empty(path);
    let repo = match Repository::open(path) {
        Ok(repo) => repo,
        Err(e) => {
            return RepoRemotePlan {
                error: Some(e.message().to_string()),
                ..base
            }
            .skipped(RemotePlanSkipReason::Error)
        }
    };
    let base = RepoRemotePlan {
        fetched_at: fetched_at(&repo),
        ..base
    };
    if op != RemotePlanOp::Fetch && is_unborn(&repo) {
        return base.skipped(RemotePlanSkipReason::Unborn);
    }
    match sync_target_from_repo(&repo) {
        Ok(target) => plan_with_target(&repo, &target, op, base),
        Err(e) => skipped_by_error(base, e),
    }
}

/// 원격 선택 규칙이 돌려준 에러 코드(`commands/git.rs`의 `remote_error`)를 건너뛰는 이유로 바꾼다.
fn skip_reason_from_error(err: &AppError) -> RemotePlanSkipReason {
    let AppError::GitCli { message, .. } = err else {
        return RemotePlanSkipReason::Error;
    };
    match message.as_str() {
        "detached_head" => RemotePlanSkipReason::DetachedHead,
        "no_remote" => RemotePlanSkipReason::NoRemote,
        "multiple_remotes" => RemotePlanSkipReason::MultipleRemotes,
        m if m.starts_with("no_upstream:") => RemotePlanSkipReason::NoUpstream,
        _ => RemotePlanSkipReason::Error,
    }
}

fn skipped_by_error(base: RepoRemotePlan, err: AppError) -> RepoRemotePlan {
    match skip_reason_from_error(&err) {
        RemotePlanSkipReason::Error => RepoRemotePlan {
            error: Some(err.to_string()),
            ..base
        }
        .skipped(RemotePlanSkipReason::Error),
        reason => base.skipped(reason),
    }
}

/// 커밋이 하나도 없는 저장소(HEAD가 아직 없는 브랜치를 가리킴).
fn is_unborn(repo: &Repository) -> bool {
    repo.head().is_err() && repo.head_detached().ok() != Some(true)
}

fn plan_with_target(
    repo: &Repository,
    target: &SyncTarget,
    op: RemotePlanOp,
    base: RepoRemotePlan,
) -> RepoRemotePlan {
    let base = RepoRemotePlan {
        branch: target.branch.clone(),
        ..base
    };
    match op {
        RemotePlanOp::Fetch => plan_fetch(target, base),
        RemotePlanOp::Pull => plan_pull(repo, target, base),
        RemotePlanOp::Push => plan_push(repo, target, base),
    }
}

/// `git_fetch`와 같이 `fetch_remotes()`의 원격마다 `git fetch --prune <원격>`을 실행한다.
fn plan_fetch(target: &SyncTarget, base: RepoRemotePlan) -> RepoRemotePlan {
    match target.fetch_remotes() {
        Ok(remotes) => RepoRemotePlan {
            remote: remotes.first().cloned(),
            command: Some(
                remotes
                    .iter()
                    .map(|r| format!("git fetch --prune {}", r))
                    .collect::<Vec<_>>()
                    .join(" && "),
            ),
            ..base
        },
        Err(e) => skipped_by_error(base, e),
    }
}

/// `git_pull`과 같이 `pull_target()`·`pull_rebase(None)`으로 명령을 만든다. 실제 인자 그대로다.
fn plan_pull(repo: &Repository, target: &SyncTarget, base: RepoRemotePlan) -> RepoRemotePlan {
    let (remote, merge_ref) = match target.pull_target() {
        Ok(pair) => pair,
        Err(e) => return skipped_by_error(base, e),
    };
    let flag = pull_mode_flag(target.pull_rebase(None))
        .map(|f| format!("{} ", f))
        .unwrap_or_default();
    let command = format!("git pull {}{} {}", flag, remote, merge_ref);
    let branch = target.branch.as_deref().unwrap_or_default();
    let ahead_behind = upstream_ahead_behind(repo, branch);
    let behind = ahead_behind.map_or(0, |(_, behind)| behind);
    let plan = RepoRemotePlan {
        remote: Some(remote),
        command: Some(command),
        commits: behind,
        behind,
        ..base
    };
    if ahead_behind.is_none() {
        // 설정은 있는데 추적 브랜치 ref 가 없다: 받을 곳이 없으므로 「받을 것 없음」이 아니다.
        // fetch refspec 이 그 브랜치를 받는 경우에만 「원격에서 사라짐」이다. 받지 않으면
        // (`--single-branch` 클론) ref 가 처음부터 없었을 뿐이다.
        if is_fetched_by_refspec(repo, branch) {
            plan.skipped(RemotePlanSkipReason::UpstreamGone)
        } else {
            plan.skipped(RemotePlanSkipReason::NotTracked)
        }
    } else if behind == 0 {
        plan.skipped(RemotePlanSkipReason::UpToDate)
    } else {
        plan
    }
}

/// `git_push`와 같이 `push_target()`으로 대상을 정한다.
fn plan_push(repo: &Repository, target: &SyncTarget, base: RepoRemotePlan) -> RepoRemotePlan {
    let (remote, refspec) = match target.push_target() {
        Ok(pair) => pair,
        Err(e) => return skipped_by_error(base, e),
    };
    let dest = refspec
        .split_once(':')
        .map_or(refspec.as_str(), |(_, dst)| dst);
    let dest = dest.strip_prefix("refs/heads/").unwrap_or(dest).to_string();
    // push는 늘 `--set-upstream`으로 실행된다(`GitCliEngine::push`). 이미 같은 곳을 추적하면
    // 바뀌는 게 없으므로, 시안 D3처럼 추적 브랜치가 바뀔 때만 `-u`를 보여 준다.
    let sets_upstream =
        target.upstream.as_ref() != Some(&(remote.clone(), format!("refs/heads/{}", dest)));
    let command = if sets_upstream {
        format!("git push -u {} {}", remote, refspec)
    } else {
        format!("git push {} {}", remote, refspec)
    };
    let remote_ref = format!("refs/remotes/{}/{}", remote, dest);
    let head = repo.head().ok().and_then(|h| h.target());
    let remote_oid = repo.refname_to_id(&remote_ref).ok();
    let (ahead, behind) = match (head, remote_oid) {
        (Some(local), Some(remote_oid)) => {
            let (a, b) = repo.graph_ahead_behind(local, remote_oid).unwrap_or((0, 0));
            (a as u32, b as u32)
        }
        (Some(local), None) => (commits_missing_on_remote(repo, local, &remote), 0),
        _ => (0, 0),
    };
    let plan = RepoRemotePlan {
        remote: Some(remote),
        command: Some(command),
        commits: ahead,
        behind,
        needs_pull: behind > 0,
        sets_upstream,
        ..base
    };
    // 「할 일 없음」은 단일 저장소 툴바(SyncZone)의 Push 버튼과 같은 기준으로 판단한다:
    // 브랜치에 (git이 인식하는) 추적 브랜치가 있고, 그 추적 브랜치 대비 앞선 커밋이 없으면
    // 건너뛴다. 추적 브랜치가 origin/main처럼 실제 push 대상(origin/feat)과 다른 이름이어도
    // 마찬가지다 — push 대상에 원격 브랜치가 아직 없어도(위 `ahead`는 push 대상 기준의 다른
    // 값), 추적 브랜치 대비로 보낼 커밋이 없으면 여전히 할 일이 없다(빈 브랜치만 새로 생긴다).
    // 추적 브랜치 자체가 없으면(git이 upstream을 찾지 못하면) 첫 게시(Publish)이므로 커밋이
    // 0개여도 건너뛰지 않는다.
    let branch_name = target.branch.as_deref().unwrap_or_default();
    let up_to_date = matches!(upstream_ahead_behind(repo, branch_name), Some((0, _)));
    if up_to_date {
        plan.skipped(RemotePlanSkipReason::UpToDate)
    } else {
        plan
    }
}

/// 원격에 이 브랜치가 없을 때 올라갈 커밋 수: 그 원격의 어느 추적 브랜치에도 없는 커밋.
/// 세는 비용을 막으려고 10,000개에서 멈춘다.
fn commits_missing_on_remote(repo: &Repository, head: git2::Oid, remote: &str) -> u32 {
    const MAX: usize = 10_000;
    let count = || -> Result<u32, git2::Error> {
        let mut walk = repo.revwalk()?;
        walk.push(head)?;
        // 추적 브랜치가 하나도 없으면 hide_glob은 아무것도 숨기지 않는다(모든 커밋이 새것).
        walk.hide_glob(&format!("refs/remotes/{}/*", remote))?;
        Ok(walk.take(MAX).filter(|r| r.is_ok()).count() as u32)
    };
    count().unwrap_or(0)
}

/// 로컬 브랜치와 추적 브랜치의 `(앞섬, 뒤처짐)`. 추적 브랜치가 없으면 `None`.
fn upstream_ahead_behind(repo: &Repository, branch: &str) -> Option<(u32, u32)> {
    let local = repo.find_branch(branch, BranchType::Local).ok()?;
    let upstream = local.upstream().ok()?;
    let (l, u) = (local.get().target()?, upstream.get().target()?);
    let (a, b) = repo.graph_ahead_behind(l, u).ok()?;
    Some((a as u32, b as u32))
}

/// `branch.<name>.merge` 가 원격의 fetch refspec 으로 `refs/remotes/...` 이름에 이어지는가.
/// libgit2 의 upstream 이름 계산은 refspec 에 맞는 것이 없으면 실패한다(ref 가 있는지는 보지 않는다).
fn is_fetched_by_refspec(repo: &Repository, branch: &str) -> bool {
    repo.branch_upstream_name(&format!("refs/heads/{}", branch))
        .ok()
        .and_then(|name| name.as_str().map(|n| n.starts_with("refs/remotes/")))
        .unwrap_or(false)
}

/// 마지막으로 성공한 fetch 시각. `FETCH_HEAD`는 워크트리마다 따로 있고, 없으면 공용 git 폴더를 본다.
///
/// git은 fetch를 시작하면서 `FETCH_HEAD`를 비우고 받아 온 ref를 적는다. 그래서 fetch가 실패하면
/// (인증·네트워크) 파일은 빈 채로 수정 시각만 지금이 된다. 그 시각을 「마지막 fetch」로 보이면
/// 오래된 계획이 방금 확인한 것처럼 보이므로, 빈 파일은 시각을 모른다고 본다.
fn fetched_at(repo: &Repository) -> Option<i64> {
    let git_dir = repo.path();
    let own = git_dir.join("FETCH_HEAD");
    let path = if own.exists() {
        own
    } else {
        // 워크트리의 git 폴더에는 공용 폴더를 가리키는 `commondir` 파일이 있다.
        let common = std::fs::read_to_string(git_dir.join("commondir")).ok()?;
        git_dir.join(common.trim()).join("FETCH_HEAD")
    };
    successful_fetch_mtime(&path)
}

fn successful_fetch_mtime(path: &Path) -> Option<i64> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() == 0 {
        return None;
    }
    let modified = meta.modified().ok()?;
    let secs = modified.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    i64::try_from(secs).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .expect("git 실행 실패");
        assert!(
            out.status.success(),
            "git {:?}: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn commit(dir: &Path, msg: &str) {
        git(dir, &["commit", "-q", "--allow-empty", "-m", msg]);
    }

    fn tmp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gitbaro-remoteplan-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn init(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "t@t"]);
        git(dir, &["config", "user.name", "t"]);
    }

    /// 원격(bare) `origin`과 그것을 clone한 작업 저장소. 작업 저장소는 `main`에 커밋 하나를
    /// 올려 두었고 추적 중이다.
    fn clone_with_origin(root: &Path) -> (PathBuf, PathBuf) {
        let seed = root.join("seed");
        init(&seed);
        commit(&seed, "init");
        let origin = root.join("origin.git");
        git(
            root,
            &["clone", "-q", "--bare", seed.to_str().unwrap(), origin.to_str().unwrap()],
        );
        let work = root.join("work");
        git(root, &["clone", "-q", origin.to_str().unwrap(), work.to_str().unwrap()]);
        git(&work, &["config", "user.email", "t@t"]);
        git(&work, &["config", "user.name", "t"]);
        (origin, work)
    }

    fn p(path: &Path) -> &str {
        path.to_str().unwrap()
    }

    #[test]
    fn push_with_tracked_branch_shows_plain_push_and_ahead_count() {
        let root = tmp_dir("tracked");
        let (_, work) = clone_with_origin(&root);
        commit(&work, "a");
        commit(&work, "b");

        let plan = plan_repo(p(&work), RemotePlanOp::Push);
        assert_eq!(plan.command.as_deref(), Some("git push origin main"));
        assert_eq!(plan.commits, 2);
        assert!(!plan.sets_upstream);
        assert!(!plan.needs_pull);
        assert!(!plan.skip);
    }

    #[test]
    fn push_without_upstream_sets_upstream_with_dash_u() {
        let root = tmp_dir("no-upstream");
        let (_, work) = clone_with_origin(&root);
        git(&work, &["checkout", "-q", "-b", "feat/x"]);
        commit(&work, "x1");
        commit(&work, "x2");
        commit(&work, "x3");

        let plan = plan_repo(p(&work), RemotePlanOp::Push);
        assert_eq!(plan.command.as_deref(), Some("git push -u origin feat/x"));
        assert!(plan.sets_upstream);
        // origin/main에 이미 있는 init 커밋은 세지 않는다.
        assert_eq!(plan.commits, 3);
        assert!(!plan.skip);
    }

    #[test]
    fn push_when_remote_moved_ahead_needs_pull() {
        let root = tmp_dir("needs-pull");
        let (origin, work) = clone_with_origin(&root);
        // 다른 사람이 origin/main에 커밋 하나를 올린다.
        let other = root.join("other");
        git(&root, &["clone", "-q", p(&origin), p(&other)]);
        git(&other, &["config", "user.email", "o@o"]);
        git(&other, &["config", "user.name", "o"]);
        commit(&other, "theirs");
        git(&other, &["push", "-q", "origin", "main"]);
        commit(&work, "mine");
        git(&work, &["fetch", "-q", "origin"]);

        let plan = plan_repo(p(&work), RemotePlanOp::Push);
        assert!(plan.needs_pull);
        assert_eq!(plan.commits, 1);
        assert_eq!(plan.behind, 1, "안내에 원격에만 있는 커밋 수를 보여 준다");
        assert!(!plan.skip);
        assert!(plan.fetched_at.is_some(), "fetch 뒤에는 FETCH_HEAD 시각이 있어야 함");

        // 같은 상태에서 Pull 계획은 받을 커밋 1개.
        let pull = plan_repo(p(&work), RemotePlanOp::Pull);
        assert_eq!(pull.commits, 1);
        assert_eq!(pull.command.as_deref(), Some("git pull --no-rebase origin refs/heads/main"));
        assert!(!pull.skip);
    }

    #[test]
    fn nothing_to_send_or_receive_is_skipped() {
        let root = tmp_dir("up-to-date");
        let (_, work) = clone_with_origin(&root);

        let push = plan_repo(p(&work), RemotePlanOp::Push);
        assert!(push.skip);
        assert_eq!(push.skip_reason, Some(RemotePlanSkipReason::UpToDate));
        assert_eq!(push.command.as_deref(), Some("git push origin main"));

        let pull = plan_repo(p(&work), RemotePlanOp::Pull);
        assert!(pull.skip);
        assert_eq!(pull.skip_reason, Some(RemotePlanSkipReason::UpToDate));
    }

    /// W5 리뷰에서 찾은 버그: `git switch -c feat origin/main`처럼 추적 브랜치 이름이
    /// push 대상과 다르면(`autoSetupMerge`가 `branch.feat.merge=refs/heads/main`을 잡고
    /// `origin/feat`는 아직 없음), push 대상에는 원격 브랜치가 없어 예전 로직이 이를
    /// 「할 일 있음(첫 게시)」으로 취급해 기본으로 체크했다. 하지만 실제로는 보낼 커밋이
    /// 없고, 단일 저장소 툴바는 이 상태에서 Push를 비활성화한다(`hasUpstream && ahead===0`).
    /// 계획도 같은 기준으로 건너뛰어야 한다.
    #[test]
    fn push_with_a_differently_named_upstream_and_no_new_commits_is_skipped() {
        let root = tmp_dir("renamed-upstream");
        let (_, work) = clone_with_origin(&root);
        git(&work, &["switch", "-q", "-c", "feat", "origin/main"]);

        let plan = plan_repo(p(&work), RemotePlanOp::Push);
        assert_eq!(plan.command.as_deref(), Some("git push -u origin feat"));
        assert!(plan.sets_upstream);
        assert_eq!(plan.commits, 0, "origin/main과 같은 커밋이라 보낼 게 없다");
        assert!(
            plan.skip,
            "추적 브랜치(origin/main) 대비 앞선 커밋이 없으면 건너뛰어야 한다"
        );
        assert_eq!(plan.skip_reason, Some(RemotePlanSkipReason::UpToDate));
    }

    #[test]
    fn pull_follows_the_users_rebase_setting() {
        let root = tmp_dir("pull-config");
        let (_, work) = clone_with_origin(&root);
        git(&work, &["config", "pull.rebase", "true"]);
        let pull = plan_repo(p(&work), RemotePlanOp::Pull);
        assert_eq!(pull.command.as_deref(), Some("git pull origin refs/heads/main"));
    }

    #[test]
    fn pull_without_upstream_and_detached_head_are_skipped() {
        let root = tmp_dir("pull-skip");
        let (_, work) = clone_with_origin(&root);
        git(&work, &["checkout", "-q", "-b", "local-only"]);
        let pull = plan_repo(p(&work), RemotePlanOp::Pull);
        assert_eq!(pull.skip_reason, Some(RemotePlanSkipReason::NoUpstream));

        git(&work, &["checkout", "-q", "--detach"]);
        let push = plan_repo(p(&work), RemotePlanOp::Push);
        assert_eq!(push.skip_reason, Some(RemotePlanSkipReason::DetachedHead));
        assert!(push.branch.is_none());
    }

    #[test]
    fn fetch_is_never_skipped_when_a_remote_exists() {
        let root = tmp_dir("fetch");
        let (_, work) = clone_with_origin(&root);
        let plan = plan_repo(p(&work), RemotePlanOp::Fetch);
        assert_eq!(plan.command.as_deref(), Some("git fetch --prune origin"));
        assert!(!plan.skip);
        assert_eq!(plan.commits, 0);
    }

    #[test]
    fn a_repo_without_remote_or_a_missing_path_fails_alone() {
        let root = tmp_dir("fail-alone");
        let (_, work) = clone_with_origin(&root);
        commit(&work, "a");
        let lonely = root.join("lonely");
        init(&lonely);
        commit(&lonely, "x");
        let missing = root.join("missing");

        let plans: Vec<_> = [p(&work), p(&lonely), p(&missing)]
            .iter()
            .map(|path| plan_repo(path, RemotePlanOp::Push))
            .collect();
        assert_eq!(plans.len(), 3);
        assert!(!plans[0].skip);
        assert_eq!(plans[0].commits, 1);
        assert_eq!(plans[1].skip_reason, Some(RemotePlanSkipReason::NoRemote));
        assert_eq!(plans[2].skip_reason, Some(RemotePlanSkipReason::Error));
        assert!(plans[2].error.is_some());
        assert_eq!(plans[2].path, p(&missing));
    }

    #[test]
    fn commands_never_contain_the_remote_url_or_a_token() {
        let root = tmp_dir("no-token");
        let (_, work) = clone_with_origin(&root);
        let secret = "ghp_SECRETTOKEN123";
        git(
            &work,
            &[
                "remote",
                "set-url",
                "origin",
                &format!("https://x-access-token:{}@github.com/o/r.git", secret),
            ],
        );
        git(&work, &["checkout", "-q", "-b", "feat/y"]);
        commit(&work, "y");
        for op in [RemotePlanOp::Fetch, RemotePlanOp::Pull, RemotePlanOp::Push] {
            let plan = plan_repo(p(&work), op);
            let json = serde_json::to_string(&plan).unwrap();
            assert!(!json.contains(secret), "{:?} 계획에 토큰이 들어감: {}", op, json);
            assert!(!json.contains("github.com"), "{:?} 계획에 원격 URL이 들어감", op);
        }
    }

    #[tokio::test]
    async fn push_command_matches_the_real_push_target() {
        let root = tmp_dir("matches-target");
        let (_, work) = clone_with_origin(&root);
        git(&work, &["checkout", "-q", "-b", "feat/z", "origin/main"]);
        commit(&work, "z");
        // 추적 브랜치(origin/main) 이름이 달라도 실제 push는 기본 원격에 같은 이름으로 올린다.
        let target = crate::commands::git::get_push_target(p(&work).to_string())
            .await
            .unwrap();
        let plan = plan_repo(p(&work), RemotePlanOp::Push);
        assert_eq!(
            plan.command.as_deref(),
            Some(format!("git push -u {} {}", target.remote, target.refspec).as_str())
        );
        assert!(plan.sets_upstream);
    }

    #[test]
    fn push_links_an_upstream_even_when_the_remote_branch_is_at_the_same_commit() {
        let root = tmp_dir("relink");
        let (_, work) = clone_with_origin(&root);
        git(&work, &["checkout", "-q", "-b", "feat/y"]);
        commit(&work, "y");
        git(&work, &["push", "-q", "-u", "origin", "feat/y"]);
        git(&work, &["branch", "--unset-upstream"]);

        let plan = plan_repo(p(&work), RemotePlanOp::Push);
        assert_eq!(plan.commits, 0);
        assert!(plan.sets_upstream);
        assert!(!plan.skip, "추적 브랜치를 새로 연결하는 push는 건너뛰지 않는다");
        assert_eq!(plan.command.as_deref(), Some("git push -u origin feat/y"));
    }

    #[test]
    fn a_failed_fetch_does_not_count_as_the_last_fetch() {
        let root = tmp_dir("failed-fetch");
        let (_, work) = clone_with_origin(&root);
        git(&work, &["fetch", "-q", "origin"]);
        assert!(plan_repo(p(&work), RemotePlanOp::Pull).fetched_at.is_some());

        git(&work, &["remote", "set-url", "origin", p(&root.join("gone.git"))]);
        let failed = Command::new("git")
            .args(["fetch", "--prune", "origin"])
            .current_dir(&work)
            .output()
            .unwrap();
        assert!(!failed.status.success());
        let plan = plan_repo(p(&work), RemotePlanOp::Pull);
        assert_eq!(plan.fetched_at, None, "실패한 fetch 시각을 마지막 fetch로 보이면 안 됨");
    }

    #[test]
    fn fetch_lists_every_remote_the_real_fetch_uses() {
        let root = tmp_dir("fork-fetch");
        let (origin, work) = clone_with_origin(&root);
        git(&work, &["remote", "add", "upstream", p(&origin)]);
        git(&work, &["fetch", "-q", "upstream"]);
        git(&work, &["branch", "-q", "--set-upstream-to", "upstream/main"]);

        let target = sync_target_from_repo(&Repository::open(&work).unwrap()).unwrap();
        let expected = target
            .fetch_remotes()
            .unwrap()
            .iter()
            .map(|r| format!("git fetch --prune {}", r))
            .collect::<Vec<_>>()
            .join(" && ");
        let plan = plan_repo(p(&work), RemotePlanOp::Fetch);
        assert_eq!(plan.command.as_deref(), Some(expected.as_str()));
        assert_eq!(
            plan.command.as_deref(),
            Some("git fetch --prune upstream && git fetch --prune origin")
        );
    }

    #[test]
    fn pull_command_uses_the_real_pull_target_and_branch_rebase_setting() {
        let root = tmp_dir("pull-target");
        let (_, work) = clone_with_origin(&root);
        git(&work, &["config", "branch.main.rebase", "true"]);
        let target = sync_target_from_repo(&Repository::open(&work).unwrap()).unwrap();
        let (remote, merge_ref) = target.pull_target().unwrap();
        assert_eq!(target.pull_rebase(None), None);
        let plan = plan_repo(p(&work), RemotePlanOp::Pull);
        assert_eq!(
            plan.command.as_deref(),
            Some(format!("git pull {} {}", remote, merge_ref).as_str())
        );
    }

    #[tokio::test]
    async fn push_default_upstream_pushes_to_the_tracked_branch() {
        let root = tmp_dir("push-default-upstream");
        let (_, work) = clone_with_origin(&root);
        git(&work, &["checkout", "-q", "-b", "feat/w", "origin/main"]);
        git(&work, &["config", "push.default", "upstream"]);
        commit(&work, "w");
        let target = crate::commands::git::get_push_target(p(&work).to_string())
            .await
            .unwrap();
        assert_eq!(target.refspec, "feat/w:refs/heads/main");
        let plan = plan_repo(p(&work), RemotePlanOp::Push);
        assert_eq!(
            plan.command.as_deref(),
            Some(format!("git push {} {}", target.remote, target.refspec).as_str()),
            "추적 브랜치 그대로 올리므로 -u 없이 보인다"
        );
        assert!(!plan.sets_upstream);
        assert_eq!(plan.commits, 1);
    }

    #[test]
    fn pull_when_the_remote_branch_was_deleted_says_so() {
        let root = tmp_dir("upstream-gone");
        let (origin, work) = clone_with_origin(&root);
        git(&work, &["checkout", "-q", "-b", "feat"]);
        commit(&work, "a");
        git(&work, &["push", "-q", "-u", "origin", "feat"]);
        git(&origin, &["branch", "-D", "feat"]);
        git(&work, &["fetch", "-q", "--prune", "origin"]);

        let plan = plan_repo(p(&work), RemotePlanOp::Pull);
        assert!(plan.skip);
        assert_eq!(plan.skip_reason, Some(RemotePlanSkipReason::UpstreamGone));
        let json = serde_json::to_value(&plan).unwrap();
        assert_eq!(json["skipReason"], "upstreamGone");
    }

    #[test]
    fn pull_of_a_branch_this_single_branch_clone_does_not_fetch_is_not_called_gone() {
        // `--single-branch` 클론의 fetch refspec 은 main 만 받는다. 원격에 있는 feat 를 추적하게 해도
        // refs/remotes/origin/feat 는 생기지 않는다 — 원격에서 지운 것이 아니다.
        let root = tmp_dir("single-branch");
        let (origin, _) = clone_with_origin(&root);
        let work = root.join("narrow");
        git(
            &root,
            &["clone", "-q", "--single-branch", "--branch", "main", p(&origin), p(&work)],
        );
        git(&origin, &["branch", "feat", "main"]);
        git(&work, &["checkout", "-q", "-b", "feat"]);
        git(&work, &["config", "branch.feat.remote", "origin"]);
        git(&work, &["config", "branch.feat.merge", "refs/heads/feat"]);

        let plan = plan_repo(p(&work), RemotePlanOp::Pull);
        assert!(plan.skip);
        assert_eq!(plan.skip_reason, Some(RemotePlanSkipReason::NotTracked));
        let json = serde_json::to_value(&plan).unwrap();
        assert_eq!(json["skipReason"], "notTracked");
    }

    #[test]
    fn remote_error_codes_become_skip_reasons() {
        let code = |m: &str| AppError::GitCli {
            message: m.to_string(),
            exit_code: None,
        };
        assert_eq!(skip_reason_from_error(&code("detached_head")), RemotePlanSkipReason::DetachedHead);
        assert_eq!(skip_reason_from_error(&code("no_remote")), RemotePlanSkipReason::NoRemote);
        assert_eq!(
            skip_reason_from_error(&code("multiple_remotes")),
            RemotePlanSkipReason::MultipleRemotes
        );
        assert_eq!(skip_reason_from_error(&code("no_upstream:x")), RemotePlanSkipReason::NoUpstream);
        assert_eq!(skip_reason_from_error(&code("boom")), RemotePlanSkipReason::Error);
    }

    #[test]
    fn op_and_plan_serialize_in_camel_case() {
        let op: RemotePlanOp = serde_json::from_str("\"push\"").unwrap();
        assert_eq!(op, RemotePlanOp::Push);
        let plan = RepoRemotePlan::empty("/r").skipped(RemotePlanSkipReason::UpToDate);
        let json = serde_json::to_value(&plan).unwrap();
        assert_eq!(json["skipReason"], "upToDate");
        assert_eq!(json["needsPull"], false);
        assert_eq!(json["setsUpstream"], false);
        assert!(json.get("fetchedAt").is_some());
    }
}
