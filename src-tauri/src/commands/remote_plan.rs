//! 여러 저장소 Fetch·Pull·Push 확인 창(D3)에 보여 줄 저장소별 실행 계획.
//!
//! 저장소마다 따로 계산한다. 한 저장소를 읽지 못해도 그 저장소의 `skip_reason`·`error`만 채우고
//! 나머지 계획은 그대로 돌려준다. 계획은 로컬 상태(마지막 fetch 결과)만 읽는다. 원격에 새 커밋이
//! 있는지 알려면 호출 쪽이 먼저 fetch를 돌려야 한다(`fetched_at`으로 기준 시각을 알린다).
//!
//! 명령 문자열은 원격 **이름**과 브랜치로만 만든다. 원격 URL이나 토큰은 넣지 않는다.
//! 실제 실행은 기존 `git_fetch`·`git_pull`·`git_push` 명령이 저장소마다 따로 한다.
//! 원격 선택 규칙은 그 명령들(`commands/git.rs`의 `SyncTarget`)과 같게 맞춘다. push 대상은
//! `get_push_target`을 그대로 불러 실제 실행과 어긋나지 않게 한다.

use std::path::Path;

use git2::{BranchType, Repository};
use serde::{Deserialize, Serialize};

use crate::error::AppError;

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
    /// 원격 브랜치에 로컬에 없는 커밋이 있다(마지막 fetch 기준). Push는 먼저 Pull이 필요하다.
    pub needs_pull: bool,
    /// Push가 추적 브랜치를 새로 연결하거나 바꾼다(`-u`).
    pub sets_upstream: bool,
    /// 이번 작업에서 뺀다. 확인 창에서 체크를 풀고 흐리게 보여 준다.
    pub skip: bool,
    pub skip_reason: Option<RemotePlanSkipReason>,
    /// 마지막 fetch 시각(유닉스 초). `FETCH_HEAD`의 수정 시각. fetch한 적이 없으면 `None`.
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
    match read_sync_config(&repo) {
        Ok(config) => plan_with_config(&repo, &config, op, base),
        Err(e) => RepoRemotePlan {
            error: Some(e.to_string()),
            ..base
        }
        .skipped(RemotePlanSkipReason::Error),
    }
}

/// 원격 선택에 필요한 저장소 설정. `commands/git.rs`의 `SyncTarget`과 같은 값을 읽는다.
struct SyncConfig {
    branch: Option<String>,
    /// `(branch.<name>.remote, branch.<name>.merge)`.
    upstream: Option<(String, String)>,
    remotes: Vec<String>,
    push_default: Option<String>,
    pull_mode_configured: bool,
    unborn: bool,
}

fn read_sync_config(repo: &Repository) -> Result<SyncConfig, AppError> {
    let unborn = repo.head().is_err() && repo.head_detached().ok() != Some(true);
    let branch = head_branch_name(repo);
    let config = repo.config()?;
    let upstream = branch.as_ref().and_then(|name| {
        let remote = config.get_string(&format!("branch.{}.remote", name)).ok()?;
        let merge = config.get_string(&format!("branch.{}.merge", name)).ok()?;
        Some((remote, merge))
    });
    let remotes = repo
        .remotes()?
        .iter()
        .flatten()
        .map(str::to_string)
        .collect();
    let is_set = |key: &str| config.get_entry(key).is_ok();
    let pull_mode_configured = is_set("pull.rebase")
        || branch
            .as_ref()
            .is_some_and(|name| is_set(&format!("branch.{}.rebase", name)));
    Ok(SyncConfig {
        branch,
        upstream,
        remotes,
        push_default: config.get_string("push.default").ok(),
        pull_mode_configured,
        unborn,
    })
}

/// HEAD가 가리키는 로컬 브랜치 이름. 커밋이 없는 저장소도 이름을 준다. detached면 `None`.
fn head_branch_name(repo: &Repository) -> Option<String> {
    if repo.head_detached().unwrap_or(false) {
        return None;
    }
    let head = repo.find_reference("HEAD").ok()?;
    let target = head.symbolic_target()?;
    target.strip_prefix("refs/heads/").map(str::to_string)
}

impl SyncConfig {
    fn upstream_remote(&self) -> Option<&str> {
        self.upstream
            .as_ref()
            .map(|(remote, _)| remote.as_str())
            .filter(|remote| *remote != ".")
    }

    fn default_remote(&self) -> Result<String, RemotePlanSkipReason> {
        if self.remotes.iter().any(|r| r == "origin") {
            return Ok("origin".to_string());
        }
        match self.remotes.as_slice() {
            [only] => Ok(only.clone()),
            [] => Err(RemotePlanSkipReason::NoRemote),
            _ => Err(RemotePlanSkipReason::MultipleRemotes),
        }
    }

    fn fetch_remotes(&self) -> Result<Vec<String>, RemotePlanSkipReason> {
        let upstream = self.upstream_remote().map(str::to_string);
        match (upstream, self.default_remote()) {
            (Some(up), Ok(def)) if up != def => Ok(vec![up, def]),
            (Some(up), _) => Ok(vec![up]),
            (None, default) => default.map(|def| vec![def]),
        }
    }

    /// push 대상 `(원격, refspec)`. `get_push_target`과 같은 규칙이다.
    fn push_target(&self, branch: &str) -> Result<(String, String), RemotePlanSkipReason> {
        if let (Some((_, merge)), Some(remote)) = (&self.upstream, self.upstream_remote()) {
            let upstream_name = merge.strip_prefix("refs/heads/").unwrap_or(merge);
            if upstream_name == branch {
                return Ok((remote.to_string(), branch.to_string()));
            }
            if matches!(self.push_default.as_deref(), Some("upstream" | "tracking")) {
                return Ok((remote.to_string(), format!("{}:{}", branch, merge)));
            }
        }
        Ok((self.default_remote()?, branch.to_string()))
    }

    /// pull에 넘길 방식 플래그. 설정이 있으면 따르고(플래그 없음), 없으면 `--no-rebase`.
    fn pull_mode_flag(&self) -> Option<&'static str> {
        (!self.pull_mode_configured).then_some("--no-rebase")
    }
}

fn plan_with_config(
    repo: &Repository,
    config: &SyncConfig,
    op: RemotePlanOp,
    base: RepoRemotePlan,
) -> RepoRemotePlan {
    let base = RepoRemotePlan {
        branch: config.branch.clone(),
        ..base
    };
    match op {
        RemotePlanOp::Fetch => plan_fetch(config, base),
        RemotePlanOp::Pull => plan_pull(repo, config, base),
        RemotePlanOp::Push => plan_push(repo, config, base),
    }
}

fn plan_fetch(config: &SyncConfig, base: RepoRemotePlan) -> RepoRemotePlan {
    match config.fetch_remotes() {
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
        Err(reason) => base.skipped(reason),
    }
}

fn plan_pull(repo: &Repository, config: &SyncConfig, base: RepoRemotePlan) -> RepoRemotePlan {
    let Some(branch) = config.branch.as_deref() else {
        return base.skipped(RemotePlanSkipReason::DetachedHead);
    };
    if config.unborn {
        return base.skipped(RemotePlanSkipReason::Unborn);
    }
    let Some((remote, merge)) = config.upstream.clone() else {
        return base.skipped(RemotePlanSkipReason::NoUpstream);
    };
    let flag = config
        .pull_mode_flag()
        .map(|f| format!("{} ", f))
        .unwrap_or_default();
    let merge_name = merge.strip_prefix("refs/heads/").unwrap_or(&merge);
    let command = format!("git pull {}{} {}", flag, remote, merge_name);
    let behind = upstream_ahead_behind(repo, branch).map_or(0, |(_, behind)| behind);
    let plan = RepoRemotePlan {
        remote: Some(remote),
        command: Some(command),
        commits: behind,
        ..base
    };
    if behind == 0 {
        plan.skipped(RemotePlanSkipReason::UpToDate)
    } else {
        plan
    }
}

fn plan_push(repo: &Repository, config: &SyncConfig, base: RepoRemotePlan) -> RepoRemotePlan {
    let Some(branch) = config.branch.clone() else {
        return base.skipped(RemotePlanSkipReason::DetachedHead);
    };
    if config.unborn {
        return base.skipped(RemotePlanSkipReason::Unborn);
    }
    let (remote, refspec) = match config.push_target(&branch) {
        Ok(target) => target,
        Err(reason) => return base.skipped(reason),
    };
    let dest = refspec
        .split_once(':')
        .map_or(refspec.as_str(), |(_, dst)| dst);
    let dest = dest.strip_prefix("refs/heads/").unwrap_or(dest).to_string();
    // push는 늘 `--set-upstream`으로 실행된다. 이미 같은 곳을 추적하면 바뀌는 게 없으므로
    // 그때만 `-u` 없이 보여 준다.
    let sets_upstream = config.upstream.as_ref() != Some(&(remote.clone(), format!("refs/heads/{}", dest)));
    let command = if sets_upstream {
        format!("git push -u {} {}", remote, refspec)
    } else {
        format!("git push {} {}", remote, refspec)
    };
    let remote_ref = format!("refs/remotes/{}/{}", remote, dest);
    let head = repo.head().ok().and_then(|h| h.target());
    let remote_oid = repo.refname_to_id(&remote_ref).ok();
    let (ahead, behind, remote_has_branch) = match (head, remote_oid) {
        (Some(local), Some(remote_oid)) => {
            let (a, b) = repo.graph_ahead_behind(local, remote_oid).unwrap_or((0, 0));
            (a as u32, b as u32, true)
        }
        (Some(local), None) => (commits_missing_on_remote(repo, local, &remote), 0, false),
        _ => (0, 0, false),
    };
    let plan = RepoRemotePlan {
        remote: Some(remote),
        command: Some(command),
        commits: ahead,
        needs_pull: behind > 0,
        sets_upstream,
        ..base
    };
    // 원격에 브랜치가 없으면 커밋이 0개여도 브랜치를 새로 만드는 push는 의미가 있다.
    if remote_has_branch && ahead == 0 {
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

/// 마지막 fetch 시각. `FETCH_HEAD`는 워크트리마다 따로 있고, 없으면 공용 git 폴더를 본다.
fn fetched_at(repo: &Repository) -> Option<i64> {
    let git_dir = repo.path();
    mtime_secs(&git_dir.join("FETCH_HEAD")).or_else(|| {
        // 워크트리의 git 폴더에는 공용 폴더를 가리키는 `commondir` 파일이 있다.
        let common = std::fs::read_to_string(git_dir.join("commondir")).ok()?;
        mtime_secs(&git_dir.join(common.trim()).join("FETCH_HEAD"))
    })
}

fn mtime_secs(path: &Path) -> Option<i64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
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
        assert!(!plan.skip);
        assert!(plan.fetched_at.is_some(), "fetch 뒤에는 FETCH_HEAD 시각이 있어야 함");

        // 같은 상태에서 Pull 계획은 받을 커밋 1개.
        let pull = plan_repo(p(&work), RemotePlanOp::Pull);
        assert_eq!(pull.commits, 1);
        assert_eq!(pull.command.as_deref(), Some("git pull --no-rebase origin main"));
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

    #[test]
    fn pull_follows_the_users_rebase_setting() {
        let root = tmp_dir("pull-config");
        let (_, work) = clone_with_origin(&root);
        git(&work, &["config", "pull.rebase", "true"]);
        let pull = plan_repo(p(&work), RemotePlanOp::Pull);
        assert_eq!(pull.command.as_deref(), Some("git pull origin main"));
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
