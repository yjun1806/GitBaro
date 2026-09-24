// ── Automatic remote sync ───────────────────────────────────────────────────
// 저장소별 "원격 자동 최신화"의 백엔드 쪽. 원격 fetch는 기존 `git_fetch`를 그대로
// 쓰고(계정 토큰·askpass·인증 재시도 포함), 여기서는 fetch 뒤의 두 단계를 맡는다.
//
// 1. `get_auto_sync_snapshot` — 자동으로 받아도 되는지 판단할 저장소 상태를 읽는다
//    (읽기 전용, git2).
// 2. `auto_fast_forward` — 같은 조건을 직전에 한 번 더 확인하고 현재 브랜치를
//    upstream으로 fast-forward한다(git CLI, 훅 실행).
//
// 작업 중인 에이전트를 방해하지 않는 것이 최우선이다. 조건이 하나라도 어긋나면
// 오류가 아니라 "건너뜀"(`commits: 0`)으로 돌려준다.

use crate::error::AppError;
use crate::git::cli::GitCliEngine;
use crate::git::libgit::is_working_tree_dirty;
use serde::Serialize;

/// fast-forward 판단에 필요한 저장소 상태. fetch가 끝난 뒤의 원격 추적 브랜치 기준이다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoSyncSnapshot {
    /// HEAD가 브랜치가 아니라 커밋을 가리킨다.
    pub detached: bool,
    /// 현재 브랜치에 추적 브랜치가 있다.
    pub has_upstream: bool,
    pub ahead: usize,
    pub behind: usize,
    /// 스테이징·수정·추적되지 않은 파일이 하나도 없다(무시된 파일 제외).
    pub is_clean: bool,
    /// merge·rebase·cherry-pick·revert·bisect 중 하나가 진행 중이다.
    pub operation_in_progress: bool,
}

impl AutoSyncSnapshot {
    /// 시간 조건(최근 파일 변경)을 뺀 git 상태만으로 fast-forward가 안전한지.
    /// 프론트엔드의 `decideAutoSync`와 같은 규칙이다.
    pub fn is_fast_forward_safe(&self) -> bool {
        !self.detached
            && self.has_upstream
            && self.ahead == 0
            && self.behind > 0
            && self.is_clean
            && !self.operation_in_progress
    }
}

/// 자동 fast-forward 결과. `commits`가 0이면 조건이 맞지 않아 건너뛴 것이다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoFastForward {
    pub commits: usize,
}

fn read_snapshot(repo: &git2::Repository) -> AutoSyncSnapshot {
    let operation_in_progress = repo.state() != git2::RepositoryState::Clean;
    let is_clean = !is_working_tree_dirty(repo);
    let head = repo.head().ok();
    let detached = repo.head_detached().unwrap_or(false);

    let branch = head
        .as_ref()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand())
        .and_then(|name| repo.find_branch(name, git2::BranchType::Local).ok());

    let (has_upstream, ahead, behind) = match branch {
        Some(branch) => match branch.upstream().ok() {
            Some(upstream) => match (branch.get().target(), upstream.get().target()) {
                (Some(local), Some(remote)) => {
                    let (a, b) = repo.graph_ahead_behind(local, remote).unwrap_or((0, 0));
                    (true, a, b)
                }
                _ => (true, 0, 0),
            },
            None => (false, 0, 0),
        },
        None => (false, 0, 0),
    };

    AutoSyncSnapshot {
        detached,
        has_upstream,
        ahead,
        behind,
        is_clean,
        operation_in_progress,
    }
}

async fn load_snapshot(repo_path: &str) -> Result<AutoSyncSnapshot, AppError> {
    let rp = repo_path.to_string();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&rp)?;
        Ok::<_, AppError>(read_snapshot(&repo))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

#[tauri::command]
pub async fn get_auto_sync_snapshot(repo_path: String) -> Result<AutoSyncSnapshot, AppError> {
    load_snapshot(&repo_path).await
}

/// 현재 브랜치를 upstream으로 fast-forward한다. 호출 직전에 조건을 다시 확인해,
/// 프론트엔드가 판단한 뒤 그 사이에 작업 트리가 바뀌었으면 건너뛴다.
///
/// 저장소에 등록된 경로(메인 작업 트리)에만 호출한다. 연결된 워크트리는 이번
/// 범위에서 자동으로 받지 않는다 — 에이전트가 주로 일하는 곳이라 더 보수적으로 둔다.
#[tauri::command]
pub async fn auto_fast_forward(
    repo_path: String,
    app_handle: tauri::AppHandle,
) -> Result<AutoFastForward, AppError> {
    let engine = GitCliEngine::with_app_handle(std::path::Path::new(&repo_path), app_handle);
    fast_forward_if_safe(&engine, &repo_path).await
}

async fn fast_forward_if_safe(
    engine: &GitCliEngine,
    repo_path: &str,
) -> Result<AutoFastForward, AppError> {
    let snapshot = load_snapshot(repo_path).await?;
    if !snapshot.is_fast_forward_safe() {
        tracing::info!("[git] auto fast-forward skipped for {}: {:?}", repo_path, snapshot);
        return Ok(AutoFastForward { commits: 0 });
    }
    engine.fast_forward_to_upstream().await?;
    tracing::info!(
        "[git] auto fast-forwarded {} by {} commit(s)",
        repo_path,
        snapshot.behind
    );
    Ok(AutoFastForward {
        commits: snapshot.behind,
    })
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

    fn commit_file(dir: &Path, file: &str, content: &str, message: &str) {
        std::fs::write(dir.join(file), content).unwrap();
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-qm", message]);
    }

    /// 원격(bare)과 클론 둘(a, b)을 만든다. b가 원격에 커밋 하나를 더 올리고,
    /// a는 fetch만 해 둔 상태(뒤처짐 1)로 돌려준다.
    fn behind_clone(name: &str) -> (PathBuf, PathBuf) {
        let tmp = std::env::temp_dir()
            .join(format!("gitbaro-autosync-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        git(&tmp, &["init", "-q", "--bare", "-b", "main", "remote.git"]);
        for clone in ["a", "b"] {
            git(&tmp, &["clone", "-q", "remote.git", clone]);
            let dir = tmp.join(clone);
            git(&dir, &["config", "user.name", "t"]);
            git(&dir, &["config", "user.email", "t@t"]);
        }
        let a = tmp.join("a");
        let b = tmp.join("b");
        commit_file(&a, "f", "base\n", "init");
        git(&a, &["push", "-q", "-u", "origin", "main"]);
        git(&b, &["pull", "-q", "origin", "main"]);
        commit_file(&b, "g", "from b\n", "b");
        git(&b, &["push", "-q", "origin", "main"]);
        git(&a, &["fetch", "-q", "origin"]);
        (tmp, a)
    }

    fn snapshot(dir: &Path) -> AutoSyncSnapshot {
        read_snapshot(&git2::Repository::open(dir).unwrap())
    }

    #[tokio::test]
    async fn fast_forwards_a_clean_branch_that_is_only_behind() {
        let (tmp, a) = behind_clone("ff-ok");
        let before = snapshot(&a);
        let result = fast_forward_if_safe(&GitCliEngine::new(&a), a.to_str().unwrap()).await;
        let head = git(&a, &["rev-parse", "HEAD"]);
        let upstream = git(&a, &["rev-parse", "origin/main"]);
        let _ = std::fs::remove_dir_all(&tmp);

        assert!(before.is_fast_forward_safe(), "{:?}", before);
        assert_eq!(result.unwrap(), AutoFastForward { commits: 1 });
        assert_eq!(head, upstream);
    }

    /// 갈라졌으면(ahead > 0) 건너뛰고 merge 커밋을 만들지 않는다.
    #[tokio::test]
    async fn skips_when_the_branch_has_diverged() {
        let (tmp, a) = behind_clone("ff-diverged");
        commit_file(&a, "local", "mine\n", "local work");
        let head_before = git(&a, &["rev-parse", "HEAD"]);
        let snap = snapshot(&a);
        let result = fast_forward_if_safe(&GitCliEngine::new(&a), a.to_str().unwrap()).await;
        let head_after = git(&a, &["rev-parse", "HEAD"]);
        let _ = std::fs::remove_dir_all(&tmp);

        assert_eq!((snap.ahead, snap.behind), (1, 1));
        assert_eq!(result.unwrap(), AutoFastForward { commits: 0 });
        assert_eq!(head_before, head_after);
    }

    /// 조건 확인을 건너뛰고 바로 부르더라도 `--ff-only`가 갈라진 브랜치를 거부한다.
    #[tokio::test]
    async fn ff_only_merge_refuses_a_diverged_branch() {
        let (tmp, a) = behind_clone("ff-refuse");
        commit_file(&a, "local", "mine\n", "local work");
        let head_before = git(&a, &["rev-parse", "HEAD"]);
        let result = GitCliEngine::new(&a).fast_forward_to_upstream().await;
        let head_after = git(&a, &["rev-parse", "HEAD"]);
        let merging = a.join(".git/MERGE_HEAD").exists();
        let _ = std::fs::remove_dir_all(&tmp);

        assert!(result.is_err());
        assert_eq!(head_before, head_after);
        assert!(!merging);
    }

    /// 수정 중인 파일이나 새 파일이 있으면 받지 않는다(에이전트가 작업 중일 수 있다).
    #[tokio::test]
    async fn skips_when_the_working_tree_has_changes() {
        let (tmp, a) = behind_clone("ff-dirty");
        std::fs::write(a.join("scratch.txt"), "agent output\n").unwrap();
        let untracked = snapshot(&a);
        std::fs::remove_file(a.join("scratch.txt")).unwrap();
        std::fs::write(a.join("f"), "edited\n").unwrap();
        let modified = snapshot(&a);
        let result = fast_forward_if_safe(&GitCliEngine::new(&a), a.to_str().unwrap()).await;
        let behind_after = snapshot(&a).behind;
        let _ = std::fs::remove_dir_all(&tmp);

        assert!(!untracked.is_clean);
        assert!(!modified.is_clean);
        assert_eq!(result.unwrap(), AutoFastForward { commits: 0 });
        assert_eq!(behind_after, 1);
    }

    #[tokio::test]
    async fn skips_on_a_detached_head() {
        let (tmp, a) = behind_clone("ff-detached");
        git(&a, &["checkout", "-q", "--detach", "HEAD"]);
        let snap = snapshot(&a);
        let result = fast_forward_if_safe(&GitCliEngine::new(&a), a.to_str().unwrap()).await;
        let _ = std::fs::remove_dir_all(&tmp);

        assert!(snap.detached);
        assert!(!snap.has_upstream);
        assert_eq!(result.unwrap(), AutoFastForward { commits: 0 });
    }

    #[test]
    fn a_merge_in_progress_is_not_safe() {
        let snap = AutoSyncSnapshot {
            detached: false,
            has_upstream: true,
            ahead: 0,
            behind: 2,
            is_clean: true,
            operation_in_progress: true,
        };
        assert!(!snap.is_fast_forward_safe());
        assert!(AutoSyncSnapshot { operation_in_progress: false, ..snap.clone() }.is_fast_forward_safe());
        assert!(!AutoSyncSnapshot { behind: 0, operation_in_progress: false, ..snap }.is_fast_forward_safe());
    }

    #[tokio::test]
    async fn detects_a_cherry_pick_in_progress() {
        let (tmp, a) = behind_clone("ff-op");
        // 충돌하는 cherry-pick을 일부러 멈춰 둔다.
        git(&a, &["checkout", "-q", "-b", "side"]);
        commit_file(&a, "f", "side\n", "side");
        let side = git(&a, &["rev-parse", "HEAD"]);
        git(&a, &["checkout", "-q", "main"]);
        commit_file(&a, "f", "main\n", "main");
        let _ = Command::new("git")
            .args(["cherry-pick", &side])
            .current_dir(&a)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .output();
        let snap = snapshot(&a);
        let _ = std::fs::remove_dir_all(&tmp);

        assert!(snap.operation_in_progress);
        assert!(!snap.is_fast_forward_safe());
    }
}
